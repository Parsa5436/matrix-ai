import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { hashPassword } from "@/lib/auth/password";
import { prisma } from "./client";
import {
	appendMessage,
	createConversation,
	getConversation,
	listConversations,
} from "./conversations";

// Against real Postgres, deliberately. Isolation between users is a WHERE clause, and a
// database double would assert that our double filters — which proves nothing about the
// query Postgres actually runs. This test needs DATABASE_URL to point at a live database and
// fails loudly rather than skipping if it does not: a security test that silently no-ops is
// worse than no test.

const suffix = process.pid;
const NAME_A = `test-a-${suffix}`;
const NAME_B = `test-b-${suffix}`;

let userA = "";
let userB = "";
let subjectId = "";
let conversationA = "";

beforeAll(async () => {
	const subject = await prisma.subject.findFirst({ select: { id: true } });
	if (!subject)
		throw new Error("no Subject rows — run the ingest before this test");
	subjectId = subject.id;

	const make = async (username: string) =>
		(
			await prisma.user.create({
				data: { username, passwordHash: hashPassword("password-1234") },
				select: { id: true },
			})
		).id;
	userA = await make(NAME_A);
	userB = await make(NAME_B);

	conversationA = (
		await createConversation(prisma, {
			userId: userA,
			subjectId,
			firstMessage: "چگالی جیوه چقدر است؟",
		})
	).id;
	await appendMessage(prisma, {
		conversationId: conversationA,
		userId: userA,
		role: "user",
		parts: [{ type: "text", text: "چگالی جیوه چقدر است؟" }],
	});
});

afterAll(async () => {
	// Cascades take the conversations and messages with them.
	await prisma.user.deleteMany({
		where: { username: { in: [NAME_A, NAME_B] } },
	});
	await prisma.$disconnect();
});

describe("two users are isolated", () => {
	test("the owner sees their conversation", async () => {
		const conversation = await getConversation(prisma, conversationA, userA);
		expect(conversation?.id).toBe(conversationA);
		expect(conversation?.messages).toHaveLength(1);
	});

	test("another user reading it by id gets nothing", async () => {
		// Not "an error" and not "an empty conversation" — null, which the page turns into a
		// 404. Whether the id exists is itself not theirs to learn.
		expect(await getConversation(prisma, conversationA, userB)).toBeNull();
	});

	test("another user's list does not contain it", async () => {
		const listed = await listConversations(prisma, userB);
		expect(listed.map((c) => c.id)).not.toContain(conversationA);
	});

	test("another user cannot append to it", async () => {
		const written = await appendMessage(prisma, {
			conversationId: conversationA,
			userId: userB,
			role: "user",
			parts: [{ type: "text", text: "تزریق" }],
		});
		expect(written).toBeNull();

		// and nothing landed
		const conversation = await getConversation(prisma, conversationA, userA);
		expect(conversation?.messages).toHaveLength(1);
	});

	test("a conversation id that does not exist is also null", async () => {
		expect(await getConversation(prisma, "no-such-id", userA)).toBeNull();
	});
});
