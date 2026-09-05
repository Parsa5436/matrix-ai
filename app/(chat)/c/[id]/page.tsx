import type { UIMessage } from "ai";
import { notFound, redirect } from "next/navigation";
import { Chat } from "@/components/chat/chat";
import { currentUserId } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";
import { getConversation, toUIParts } from "@/lib/db/conversations";
import { listSubjects } from "@/lib/db/subjects";
import { conversationUsage } from "@/lib/db/usage";
import { env } from "@/lib/env";

export default async function ConversationPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const userId = await currentUserId();
	if (!userId) redirect("/login");

	const { id } = await params;
	// Independent queries, so they overlap rather than queue behind each other.
	const [conversation, subjects, usage] = await Promise.all([
		getConversation(prisma, id, userId),
		listSubjects(prisma),
		// Refreshed by router.refresh() when an answer finishes, so the readout follows the
		// conversation without a poll.
		conversationUsage(prisma, id),
	]);

	// getConversation filters on userId, so another user's conversation is indistinguishable
	// from one that does not exist — which is exactly what they should be told.
	if (!conversation) notFound();

	const initialMessages: UIMessage[] = conversation.messages.map((message) => ({
		id: message.id,
		role: message.role as UIMessage["role"],
		parts: [
			...toUIParts(message.parts),
			// Generated speech lives in its own column, so it is folded back in as a part here
			// rather than threaded through the component tree as a second prop.
			...(message.audioUrl
				? [{ type: "data-audio", data: { url: message.audioUrl } }]
				: []),
		] as UIMessage["parts"],
	}));

	return (
		<Chat
			conversationId={conversation.id}
			initialMessages={initialMessages}
			subjectId={conversation.subjectId}
			subjects={subjects}
			contextLimit={env.CONTEXT_LIMIT_TOKENS}
			usage={usage}
		/>
	);
}
