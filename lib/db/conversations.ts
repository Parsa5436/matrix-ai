import type { AnswerMode } from "@/lib/answer/types";
import type { Prisma, PrismaClient } from "./generated/client";

// Every read and write here takes a userId and puts it in the WHERE clause. That is the
// whole isolation mechanism, and it lives in plain functions rather than in the route so a
// test can prove it without HTTP — see conversations.test.ts.
//
// The rule to keep: no function in this file may look up a conversation by id alone. An
// ownership check bolted on afterwards is one early return away from being skipped.

// A UIMessage part on its way to a JSONB column. Structurally typed rather than imported
// from the SDK: the column is untyped either way, and the SDK's union is not assignable from
// the object literals the route builds. It is narrowed again on read — see toUIParts.
export type StoredPart = { type: string; [key: string]: unknown };

/**
 * Parts from the database, filtered to what the UI can actually render. A row written by an
 * older shape degrades to a shorter message instead of crashing the page.
 */
/** The message's text, with data parts, files and citations left out. */
export const textOf = (parts: { type: string; [key: string]: unknown }[]) =>
	parts
		.filter((part) => part.type === "text")
		.map((part) => String(part.text ?? ""))
		.join("");

export function toUIParts(parts: unknown): StoredPart[] {
	if (!Array.isArray(parts)) return [];
	return parts.filter(
		(part): part is StoredPart =>
			typeof part === "object" &&
			part !== null &&
			typeof (part as { type?: unknown }).type === "string",
	);
}

export async function listConversations(db: PrismaClient, userId: string) {
	return db.conversation.findMany({
		where: { userId },
		select: { id: true, title: true, updatedAt: true },
		orderBy: { updatedAt: "desc" },
		take: 50,
	});
}

/** The conversation with its messages, or null if it is missing OR belongs to someone else. */
export async function getConversation(
	db: PrismaClient,
	id: string,
	userId: string,
) {
	return db.conversation.findFirst({
		// Not findUnique({ id }) followed by a check: the filter is the check.
		where: { id, userId },
		include: {
			messages: { orderBy: { createdAt: "asc" } },
			subject: { select: { id: true, title: true } },
		},
	});
}

// A question makes a poor title at full length and a good one truncated, which is all the
// titling this needs until someone asks for better.
const titleFrom = (text: string) => {
	const clean = text.replace(/\s+/g, " ").trim();
	return clean.length <= 60 ? clean || "گفتگوی جدید" : `${clean.slice(0, 60)}…`;
};

export async function createConversation(
	db: PrismaClient,
	input: { userId: string; subjectId: string; firstMessage: string },
) {
	return db.conversation.create({
		data: {
			userId: input.userId,
			subjectId: input.subjectId,
			title: titleFrom(input.firstMessage),
		},
		select: { id: true },
	});
}

export async function appendMessage(
	db: PrismaClient,
	input: {
		conversationId: string;
		userId: string;
		role: "user" | "assistant";
		parts: StoredPart[];
		mode?: AnswerMode | null;
	},
) {
	// Ownership is re-checked on every write, because a conversation id is guessable and the
	// composer sends it from the client.
	const owned = await db.conversation.findFirst({
		where: { id: input.conversationId, userId: input.userId },
		select: { id: true },
	});
	if (!owned) return null;

	const [message] = await db.$transaction([
		db.message.create({
			data: {
				conversationId: input.conversationId,
				role: input.role,
				// The column is JSONB; Prisma's input type cannot express "array of open objects".
				parts: input.parts as unknown as Prisma.InputJsonValue,
				mode: input.mode ?? null,
			},
		}),
		db.conversation.update({
			where: { id: input.conversationId },
			data: { updatedAt: new Date() },
		}),
	]);
	return message;
}
