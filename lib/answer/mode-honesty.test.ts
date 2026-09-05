import { describe, expect, test } from "bun:test";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import type { PrismaClient } from "@/lib/db/generated/client";
import { answer } from "./pipeline";
import type { AnswerInput } from "./types";

// Contract clause 6: the "روش استاد" badge is a claim about where the answer came from. It
// may only appear when the teacher's own approved card or his own exemplars are actually in
// the prompt the model was given.
//
// method-card-gate.test.ts pins one half of that — an unapproved card cannot be retrieved.
// This pins the other half, and pins it against the whole pipeline rather than against
// assemble(): the badge travels to the browser as a stream chunk, and every stage between
// retrieval and that chunk is somewhere the two could drift apart. What is asserted is the
// equivalence, not either side of it, so a change that starts emitting "teacher" from some
// new path fails here unless it also puts something of the teacher's in the prompt.
//
// The follow-up case is the one that motivated the file: the second turn of a conversation
// retrieves on its own and can come back empty, and the badge has to drop with it.

const CARD = "کارت روش استاد برای چگالی";
const EXEMPLAR = "حل خود معلم برای این نمونه";

const CLASSIFICATION = JSON.stringify({
	kind: "educational",
	topic: "چگالی",
	confidence: 1,
});

const USAGE = {
	inputTokens: {
		total: 1,
		noCache: 1,
		cacheRead: undefined,
		cacheWrite: undefined,
	},
	outputTokens: { total: 1, text: 1, reasoning: undefined },
	totalTokens: 2,
};

/**
 * Answers classification with a confident topic and any other generate call with a rewrite,
 * then records the prompt of the streaming call — the one that produces the answer, and so
 * the only one the badge is a claim about.
 */
function recordingModel() {
	const prompts: unknown[][] = [];
	const model = new MockLanguageModelV4({
		doGenerate: async ({ prompt }) => ({
			content: [
				{
					type: "text" as const,
					// classify() is the only stage that lists the topics in its prompt.
					text: JSON.stringify(prompt).includes("موضوع‌های ممکن")
						? CLASSIFICATION
						: "چگالی این آلیاژ چقدر است؟",
				},
			],
			finishReason: { unified: "stop" as const, raw: "stop" },
			usage: USAGE,
			warnings: [],
		}),
		doStream: async ({ prompt }) => {
			prompts.push(prompt as unknown[]);
			return {
				stream: simulateReadableStream({
					chunks: [
						{ type: "text-start" as const, id: "t" },
						{ type: "text-delta" as const, id: "t", delta: "پاسخ" },
						{ type: "text-end" as const, id: "t" },
					],
				}),
			};
		},
	});
	return { model, prompts };
}

const dbDouble = (card: boolean, exemplars: boolean) =>
	({
		setting: {
			findUnique: async () => ({ key: "activeCorpusVersion", value: "1" }),
		},
		topic: { findMany: async () => [{ id: "topic-1" }] },
		teacher: { findFirst: async () => ({ personaPrompt: "معلم" }) },
		methodCard: { findFirst: async () => (card ? { contentMd: CARD } : null) },
		// searchExemplars returns ids and scores; Prisma then hydrates the rows.
		$queryRaw: async () =>
			exemplars ? [{ id: "exemplar-1", score: 0.9 }] : [],
		exemplar: {
			findMany: async () =>
				exemplars
					? [
							{
								id: "exemplar-1",
								question: "یک نمونه",
								solutionMd: EXEMPLAR,
								answer: "۲",
								topic: { title: "چگالی" },
							},
						]
					: [],
		},
	}) as unknown as PrismaClient;

/** Runs one turn and reports the badge it emitted next to the prompt it emitted it with. */
async function run(
	card: boolean,
	exemplars: boolean,
	history: AnswerInput["history"] = [],
) {
	const { model, prompts } = recordingModel();
	const input: AnswerInput = {
		question: "چگالی این آلیاژ چقدر است؟",
		subjectId: "subject-1",
		history,
	};

	let mode: string | null = null;
	for await (const chunk of answer(input, {
		llm: () => model,
		embed: async () => new Array(768).fill(0),
		db: dbDouble(card, exemplars),
	})) {
		if (chunk.type === "mode") mode = chunk.mode;
	}

	return { mode, wire: JSON.stringify(prompts.at(-1) ?? []) };
}

const CASES = [
	{ name: "card and exemplars", card: true, exemplars: true },
	{ name: "card only", card: true, exemplars: false },
	{ name: "exemplars only", card: false, exemplars: true },
	{ name: "neither", card: false, exemplars: false },
];

describe("the teacher badge", () => {
	for (const { name, card, exemplars } of CASES) {
		test(`${name}: the badge matches what reached the prompt`, async () => {
			const { mode, wire } = await run(card, exemplars);

			const teachersOwn = wire.includes(CARD) || wire.includes(EXEMPLAR);
			expect(teachersOwn).toBe(card || exemplars);
			// The equivalence, in both directions. Either half alone would be satisfied by a
			// pipeline that always said "teacher", or by one that never did.
			expect(mode === "teacher").toBe(teachersOwn);
		});
	}

	test("a follow-up that retrieves nothing drops the badge", async () => {
		const { mode, wire } = await run(false, false, [
			{ role: "user", text: "چگالی چیست؟" },
			{ role: "assistant", text: "چگالی جرم بر حجم است." },
		]);

		// The history is carried, so the model is not asked to answer a bare pronoun…
		expect(wire).toContain("چگالی جرم بر حجم است.");
		// …but nothing of the teacher's came back on this turn, and the badge says so.
		expect(mode).toBe("standard");
	});
});
