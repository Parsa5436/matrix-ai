import type { PrismaClient } from "./generated/client";

// What one conversation has actually cost, read from the rows metering already writes.
//
// Two different quantities, and they are easy to confuse:
//   contextTokens — how full the model's window is for the NEXT call. That is the last
//                   call's prompt, not a running total.
//   totalTokens   — everything the conversation has spent, across every call.
export type ConversationUsage = {
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
	contextTokens: number;
	calls: number;
};

export async function conversationUsage(
	db: PrismaClient,
	conversationId: string,
): Promise<ConversationUsage> {
	const [totals, latest] = await Promise.all([
		db.usage.aggregate({
			where: { conversationId },
			_sum: { promptTokens: true, completionTokens: true },
			_count: true,
		}),
		// The window is filled by the most recent generation, not by the sum of every call.
		db.usage.findFirst({
			where: { conversationId, role: "reasoning" },
			orderBy: { createdAt: "desc" },
			select: { promptTokens: true, completionTokens: true },
		}),
	]);

	const inputTokens = totals._sum.promptTokens ?? 0;
	const outputTokens = totals._sum.completionTokens ?? 0;
	return {
		inputTokens,
		outputTokens,
		totalTokens: inputTokens + outputTokens,
		contextTokens:
			(latest?.promptTokens ?? 0) + (latest?.completionTokens ?? 0),
		calls: totals._count,
	};
}
