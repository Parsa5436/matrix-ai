import { type LanguageModel, type SpeechModel, wrapLanguageModel } from "ai";
import type { PrismaClient } from "@/lib/db/generated/client";
import type { ChatRole } from "./models";

type SpeechModelV4 = Extract<SpeechModel, { specificationVersion: "v4" }>;

// Clause 8 puts third-party token cost on the client, so every call is attributed to a user
// and a ceiling is enforced before the request leaves.
//
// It is enforced HERE, wrapping the model, rather than in the route or the UI. A quota check
// in a component protects nothing — the route is still callable — and a check in the route
// is one new caller away from being bypassed. Wrapping the model means the only way to spend
// a token is through the object that counts it.

const WINDOW_HOURS = 24;

export class QuotaExceededError extends Error {
	constructor(
		readonly used: number,
		readonly cap: number,
	) {
		super(`daily token quota reached: ${used}/${cap}`);
		this.name = "QuotaExceededError";
	}
}

async function tokensUsedInWindow(
	db: PrismaClient,
	userId: string,
): Promise<number> {
	const since = new Date(Date.now() - WINDOW_HOURS * 60 * 60 * 1000);
	const totals = await db.usage.aggregate({
		where: { userId, createdAt: { gte: since } },
		_sum: { promptTokens: true, completionTokens: true },
	});
	return (totals._sum.promptTokens ?? 0) + (totals._sum.completionTokens ?? 0);
}

export type MeterContext = {
	db: PrismaClient;
	userId: string;
	/**
	 * "speech" is billed per character upstream, not per token, and its row records characters
	 * in promptTokens. Deliberate: one row shape keeps spend auditable in one query, and
	 * counting a character as a token under-charges the cap rather than over-charging it.
	 */
	role: ChatRole | "speech";
	/** Absent for scripts — the ingest and the eval spend tokens with no chat behind them. */
	conversationId?: string;
};

async function guard(ctx: MeterContext) {
	const user = await ctx.db.user.findUnique({
		where: { id: ctx.userId },
		select: { dailyTokenCap: true },
	});
	const cap = user?.dailyTokenCap ?? 0;
	const used = await tokensUsedInWindow(ctx.db, ctx.userId);
	if (used >= cap) throw new QuotaExceededError(used, cap);
}

// Never fails the student's answer. A dropped meter row is a billing gap; a thrown error
// here would be an outage, and the outage is the worse of the two.
function record(
	ctx: MeterContext,
	model: string,
	promptTokens: number | undefined,
	completionTokens: number | undefined,
) {
	ctx.db.usage
		.create({
			data: {
				userId: ctx.userId,
				conversationId: ctx.conversationId ?? null,
				role: ctx.role,
				model,
				promptTokens: promptTokens ?? 0,
				completionTokens: completionTokens ?? 0,
			},
		})
		.catch((error: unknown) => {
			console.error("[metering] failed to record usage", error);
		});
}

/**
 * The same model, but it refuses to run once the user is over their cap and writes a Usage
 * row for every call that does run.
 */
export function meteredModel(
	model: LanguageModel,
	ctx: MeterContext,
): LanguageModel {
	if (typeof model === "string")
		throw new TypeError("meteredModel needs a model instance, not an id");

	return wrapLanguageModel({
		model,
		middleware: {
			wrapGenerate: async ({ doGenerate }) => {
				await guard(ctx);
				const result = await doGenerate();
				record(
					ctx,
					model.modelId,
					result.usage.inputTokens.total,
					result.usage.outputTokens.total,
				);
				return result;
			},

			wrapStream: async ({ doStream }) => {
				await guard(ctx);
				const result = await doStream();
				// Usage only exists on the final chunk, so the stream is observed rather than
				// buffered — buffering it would cost the streaming UX the whole product needs.
				return {
					...result,
					stream: result.stream.pipeThrough(
						new TransformStream({
							transform(chunk, controller) {
								if (chunk.type === "finish")
									record(
										ctx,
										model.modelId,
										chunk.usage.inputTokens.total,
										chunk.usage.outputTokens.total,
									);
								controller.enqueue(chunk);
							},
						}),
					),
				};
			},
		},
	});
}

/**
 * The same, for speech. There is no wrapSpeechModel in the SDK and a SpeechModelV4 is one
 * method, so the wrapper is written out — the point is unchanged: the only object that can
 * spend on speech is the one that counts it.
 */
export function meteredSpeech(
	model: SpeechModel,
	ctx: MeterContext,
): SpeechModelV4 {
	// SpeechModel is a union across interface versions; our provider returns v4, and spreading
	// the union would erase which one this is.
	if (typeof model === "string" || model.specificationVersion !== "v4")
		throw new TypeError("meteredSpeech needs a v4 speech model instance");

	return {
		...model,
		doGenerate: async (options) => {
			await guard(ctx);
			const result = await model.doGenerate(options);
			record(ctx, model.modelId, options.text.length, 0);
			return result;
		},
	};
}
