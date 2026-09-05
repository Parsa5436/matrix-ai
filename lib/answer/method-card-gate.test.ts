import { describe, expect, test } from "bun:test";
import type { PrismaClient } from "@/lib/db/generated/client";
import { assemble } from "./assemble";
import { retrieve } from "./retrieve";
import type { AnswerInput, Deps } from "./types";

// Contract obligation, not a preference: a method card the teacher has not approved is a
// draft the fast model wrote off his slides. Putting one in a prompt would tell a student
// that a machine's guess is their teacher's method.
//
// The gate is enforced by getApprovedMethodCard's where clause, so the double below behaves
// like Postgres would: it returns the card only when the query actually asks for approved
// ones. If the filter is ever dropped, this test fails instead of the product lying.

const UNAPPROVED_CARD = "روش جعلی که معلم تأییدش نکرده است";

type FindFirstArgs = { where?: { teacherApproved?: boolean } };

const dbDouble = (
	card: { contentMd: string; teacherApproved: boolean } | null,
) => {
	const seen: FindFirstArgs[] = [];
	const db = {
		setting: {
			findUnique: async () => ({ key: "activeCorpusVersion", value: "1" }),
		},
		topic: { findMany: async () => [{ id: "topic-1" }] },
		exemplar: { findMany: async () => [] },
		methodCard: {
			findFirst: async (args: FindFirstArgs) => {
				seen.push(args);
				if (!card) return null;
				// Postgres would filter, so the double filters.
				if (args.where?.teacherApproved === true && !card.teacherApproved)
					return null;
				return { contentMd: card.contentMd };
			},
		},
		$queryRaw: async () => [],
	};
	// One cast, at the test boundary: the pipeline takes a PrismaClient and this is a stand-in
	// for the handful of calls retrieve() actually makes.
	return { db: db as unknown as PrismaClient, seen };
};

const deps = (db: PrismaClient): Deps => ({
	llm: () => {
		throw new Error("classify/generate must not run in this test");
	},
	embed: async () => new Array(768).fill(0),
	db,
});

const input: AnswerInput = {
	question: "چگالی یک آلیاژ را چطور حساب کنیم؟",
	subjectId: "subject-1",
	history: [],
};

const confident = {
	kind: "educational",
	topic: "چگالی",
	confidence: 1,
} as const;

describe("the method-card gate", () => {
	test("an unapproved card is not retrieved", async () => {
		const { db, seen } = dbDouble({
			contentMd: UNAPPROVED_CARD,
			teacherApproved: false,
		});
		const retrieved = await retrieve(input, confident, deps(db));
		expect(retrieved.methodCard).toBeNull();
		// and the query asked for approved ones rather than filtering afterwards
		expect(seen.every((a) => a.where?.teacherApproved === true)).toBe(true);
	});

	test("an unapproved card cannot reach the assembled prompt", async () => {
		const { db } = dbDouble({
			contentMd: UNAPPROVED_CARD,
			teacherApproved: false,
		});
		const retrieved = await retrieve(input, confident, deps(db));
		const { instructions, messages, mode } = assemble(
			input,
			retrieved,
			"persona",
		);
		const wire = JSON.stringify([instructions, messages]);
		expect(wire).not.toContain(UNAPPROVED_CARD);
		expect(wire).not.toContain("کارت روش");
		// nothing of the teacher's reached the prompt, so the badge must say so
		expect(mode).toBe("standard");
	});

	test("an approved card does reach the prompt", async () => {
		const approved = "اول یکاها را یکسان کن، بعد رابطه را بنویس";
		const { db } = dbDouble({ contentMd: approved, teacherApproved: true });
		const retrieved = await retrieve(input, confident, deps(db));
		expect(retrieved.methodCard).toBe(approved);
		const { instructions, messages, mode } = assemble(
			input,
			retrieved,
			"persona",
		);
		expect(JSON.stringify([instructions, messages])).toContain(approved);
		expect(mode).toBe("teacher");
	});

	test("the card is looked up by topic, never by similarity", async () => {
		const { db, seen } = dbDouble(null);
		await retrieve(input, confident, deps(db));
		// a topic id, not an embedding, is what selects a card
		expect(seen[0]?.where).toMatchObject({ teacherApproved: true });
		expect(JSON.stringify(seen[0]?.where)).toContain("topic-1");
	});
});
