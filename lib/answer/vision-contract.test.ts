import { describe, expect, test } from "bun:test";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import type { PrismaClient } from "@/lib/db/generated/client";
import { answer } from "./pipeline";
import type { AnswerInput, Deps } from "./types";

// The rule this file exists to keep, from the ai-layer reference: the ORIGINAL image goes
// into the final generation call. Extraction is an aid, not a replacement — a transcription
// cannot carry a graph's shape or which ray is which, and those are exactly the questions a
// student photographs.
//
// It is asserted against the prompt the model actually receives, because "we pass imageUrl
// around" is not the same claim and the plumbing is several stages long.

const PHOTO = { data: new Uint8Array([1, 2, 3, 4]), mediaType: "image/webp" };

const EXTRACTION = JSON.stringify({
	question: "کدام نمودار درست است؟",
	options: ["الف", "ب"],
	figure: "نمودار V بر حسب m، خط راست از مبدأ",
	readable: true,
});

/** Records every prompt the model is asked to generate from. */
function recordingModel() {
	const calls: unknown[][] = [];
	const model = new MockLanguageModelV4({
		doGenerate: async ({ prompt }) => {
			calls.push(prompt as unknown[]);
			return {
				content: [{ type: "text" as const, text: EXTRACTION }],
				finishReason: { unified: "stop" as const, raw: "stop" },
				usage: {
					inputTokens: {
						total: 1,
						noCache: 1,
						cacheRead: undefined,
						cacheWrite: undefined,
					},
					outputTokens: { total: 1, text: 1, reasoning: undefined },
					totalTokens: 2,
				},
				warnings: [],
			};
		},
		doStream: async ({ prompt }) => {
			calls.push(prompt as unknown[]);
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
	return { model, calls };
}

const dbDouble = () =>
	({
		setting: {
			findUnique: async () => ({ key: "activeCorpusVersion", value: "3" }),
		},
		topic: { findMany: async () => [] },
		methodCard: { findFirst: async () => null },
		exemplar: { findMany: async () => [] },
		teacher: { findFirst: async () => ({ personaPrompt: "" }) },
		$queryRaw: async () => [],
	}) as unknown as PrismaClient;

const input: AnswerInput = {
	question: "کدام گزینه؟",
	subjectId: "subject-1",
	imageUrl: "/api/files/photo.webp",
	history: [],
};

const run = async (deps: Deps) => {
	for await (const _ of answer(input, deps)) {
		// drain
	}
};

/** Every file part the model was given, across every call it received. */
const filePartsIn = (calls: unknown[][]) =>
	calls.flatMap((prompt) =>
		prompt.flatMap((message) => {
			const content = (message as { content?: unknown }).content;
			return Array.isArray(content)
				? content.filter((part) => (part as { type?: string }).type === "file")
				: [];
		}),
	);

describe("the photograph reaches the model", () => {
	test("the final generation call carries the original image, not just the transcript", async () => {
		const { model, calls } = recordingModel();
		await run({
			llm: () => model,
			embed: async () => new Array(768).fill(0),
			db: dbDouble(),
			loadImage: async () => PHOTO,
		});

		// Two calls: the extraction pass, then generation. The last one is what produces the
		// answer, and it is the one that must still hold the image.
		expect(calls.length).toBeGreaterThanOrEqual(2);
		const finalCall = calls.at(-1) ?? [];
		const filesInFinalCall = filePartsIn([finalCall]);

		expect(filesInFinalCall).toHaveLength(1);
		expect(filesInFinalCall[0]).toMatchObject({ mediaType: "image/webp" });
	});

	test("the extraction is added to the question rather than replacing the image", async () => {
		const { model, calls } = recordingModel();
		await run({
			llm: () => model,
			embed: async () => new Array(768).fill(0),
			db: dbDouble(),
			loadImage: async () => PHOTO,
		});

		const wire = JSON.stringify(calls.at(-1));
		// what the extraction read
		expect(wire).toContain("نمودار V بر حسب m");
		// and what the student typed
		expect(wire).toContain("کدام گزینه؟");
	});

	test("without loadImage the pipeline still answers, with no image part", async () => {
		const { model, calls } = recordingModel();
		await run({
			llm: () => model,
			embed: async () => new Array(768).fill(0),
			db: dbDouble(),
		});

		expect(filePartsIn(calls)).toHaveLength(0);
	});
});
