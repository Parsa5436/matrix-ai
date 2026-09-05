import { describe, expect, test } from "bun:test";
import type {
	LanguageModelV4FinishReason,
	LanguageModelV4GenerateResult,
	LanguageModelV4StreamPart,
} from "@ai-sdk/provider";
import { generateText, simulateReadableStream, streamText } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import type { PrismaClient } from "@/lib/db/generated/client";
import { meteredModel, QuotaExceededError } from "./metering";

// The quota is enforced by the object that spends the tokens, not by the route or the UI.
// These tests call the wrapped model directly, with no route and no HTTP, because that is
// exactly the bypass they exist to rule out.

const USAGE = {
	inputTokens: {
		total: 120,
		noCache: 120,
		cacheRead: undefined,
		cacheWrite: undefined,
	},
	outputTokens: { total: 80, text: 80, reasoning: undefined },
	totalTokens: 200,
};

const FINISH: LanguageModelV4FinishReason = { unified: "stop", raw: "stop" };

const STREAM: LanguageModelV4StreamPart[] = [
	{ type: "text-start", id: "t" },
	{ type: "text-delta", id: "t", delta: "سلام" },
	{ type: "text-end", id: "t" },
	{ type: "finish", finishReason: FINISH, usage: USAGE },
];

const GENERATED: LanguageModelV4GenerateResult = {
	content: [{ type: "text", text: "سلام" }],
	finishReason: FINISH,
	usage: USAGE,
	warnings: [],
};

const model = () =>
	new MockLanguageModelV4({
		doGenerate: async () => GENERATED,
		doStream: async () => ({
			stream: simulateReadableStream({ chunks: STREAM }),
		}),
	});

type Written = { promptTokens: number; completionTokens: number; role: string };

const dbDouble = (opts: { cap: number; alreadyUsed: number }) => {
	const written: Written[] = [];
	const db = {
		user: { findUnique: async () => ({ dailyTokenCap: opts.cap }) },
		usage: {
			aggregate: async () => ({
				_sum: {
					promptTokens: opts.alreadyUsed,
					completionTokens: 0,
				},
			}),
			create: async ({ data }: { data: Written }) => {
				written.push(data);
				return data;
			},
		},
	};
	return { db: db as unknown as PrismaClient, written };
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

describe("metering", () => {
	test("records prompt and completion tokens against the user", async () => {
		const { db, written } = dbDouble({ cap: 1000, alreadyUsed: 0 });
		await generateText({
			model: meteredModel(model(), { db, userId: "u1", role: "reasoning" }),
			prompt: "سلام",
		});
		await settle();

		expect(written).toHaveLength(1);
		expect(written[0]).toMatchObject({
			promptTokens: 120,
			completionTokens: 80,
			role: "reasoning",
		});
	});

	test("records a streamed call too, without buffering it", async () => {
		const { db, written } = dbDouble({ cap: 1000, alreadyUsed: 0 });
		const result = streamText({
			model: meteredModel(model(), { db, userId: "u1", role: "reasoning" }),
			prompt: "سلام",
		});

		let text = "";
		for await (const delta of result.textStream) text += delta;
		await settle();

		expect(text).toBe("سلام");
		expect(written[0]).toMatchObject({
			promptTokens: 120,
			completionTokens: 80,
		});
	});

	test("refuses to generate once the user is over their cap", async () => {
		const { db, written } = dbDouble({ cap: 500, alreadyUsed: 500 });
		await expect(
			generateText({
				model: meteredModel(model(), { db, userId: "u1", role: "reasoning" }),
				prompt: "سلام",
			}),
		).rejects.toThrow(QuotaExceededError);
		expect(written).toHaveLength(0);
	});

	test("refuses to stream once the user is over their cap", async () => {
		const { db, written } = dbDouble({ cap: 500, alreadyUsed: 900 });
		// streamText reports a failure through onError and ends the stream rather than
		// throwing out of textStream — which is also how the route sees it, so that is what
		// is asserted here.
		let reported: unknown;
		const result = streamText({
			model: meteredModel(model(), { db, userId: "u1", role: "reasoning" }),
			prompt: "سلام",
			onError: ({ error }) => {
				reported = error;
			},
		});

		let text = "";
		for await (const delta of result.textStream) text += delta;
		await settle();

		expect(reported).toBeInstanceOf(QuotaExceededError);
		// The cap is decorative if any token gets out before the refusal.
		expect(text).toBe("");
		expect(written).toHaveLength(0);
	});

	test("a user just under the cap is still served", async () => {
		const { db, written } = dbDouble({ cap: 500, alreadyUsed: 499 });
		await generateText({
			model: meteredModel(model(), { db, userId: "u1", role: "fast" }),
			prompt: "سلام",
		});
		await settle();
		expect(written).toHaveLength(1);
	});
});
