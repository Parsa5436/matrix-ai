"use client";

import {
	Context,
	ContextContent,
	ContextContentBody,
	ContextContentHeader,
	ContextInputUsage,
	ContextOutputUsage,
	ContextTrigger,
} from "@/components/ai-elements/context";
import type { ConversationUsage } from "@/lib/db/usage";

// Real rows, not an estimate: every number here comes from lib/ai/metering.ts, which records
// what the provider reported for each call against this conversation.
//
// `modelId` is deliberately NOT passed. The component prices a conversation through tokenlens,
// which returns nothing for our model id — and even if it did, it carries vendor list prices
// while we buy through a reseller. A cost line we know to be wrong is worse than none.
export function ContextUsage({
	usage,
	maxTokens,
}: {
	usage: ConversationUsage;
	maxTokens: number;
}) {
	if (usage.calls === 0) return null;

	return (
		<Context
			maxTokens={maxTokens}
			usage={{
				inputTokens: usage.inputTokens,
				outputTokens: usage.outputTokens,
			}}
			// The window is filled by the last call's prompt, not by the running total.
			usedTokens={usage.contextTokens}
		>
			<ContextTrigger aria-label="مصرف پنجره‌ی متن" />
			<ContextContent>
				<ContextContentHeader />
				<ContextContentBody>
					<div className="space-y-1">
						<ContextInputUsage />
						<ContextOutputUsage />
					</div>
				</ContextContentBody>
			</ContextContent>
		</Context>
	);
}
