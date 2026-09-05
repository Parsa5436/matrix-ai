import { describe, expect, test } from "bun:test";
import type { PrismaClient } from "@/lib/db/generated/client";
import { retrieve } from "./retrieve";
import type { AnswerInput, Deps } from "./types";

// The widening retry. A confident topic with almost nothing behind it produces a worse
// prompt than a subject-wide search, but dropping the SUBJECT filter would let a physics
// question be answered from a maths exemplar — so this proves both halves: the second
// search happens, and it still carries the subject.

const hit = (id: string) => ({ id, score: 1 });

// `$queryRaw` is called as a tagged template, so the double is the tag: template strings
// first, then one argument per interpolated value. A composed fragment (Prisma.join for the
// topic list) arrives as one nested Sql object rather than as its values, so it is flattened
// before the assertions look for a topic id.
type Query = { values: unknown[] };

const flatten = (values: unknown[]): unknown[] =>
	values.flatMap((value) => {
		const nested = (value as { values?: unknown[] })?.values;
		return Array.isArray(nested) ? flatten(nested) : [value];
	});

/** Postgres stands in as a function of "were topic ids in the WHERE clause". */
const dbDouble = (results: { withTopic: string[]; withoutTopic: string[] }) => {
	const queries: Query[] = [];
	const db = {
		setting: {
			findUnique: async () => ({ key: "activeCorpusVersion", value: "3" }),
		},
		topic: { findMany: async () => [{ id: "topic-1" }, { id: "topic-2" }] },
		methodCard: { findFirst: async () => null },
		exemplar: {
			findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
				where.id.in.map((id) => ({
					id,
					question: `q-${id}`,
					solutionMd: `s-${id}`,
					answer: "",
					topic: { title: "چگالی" },
				})),
		},
		$queryRaw: async (_strings: TemplateStringsArray, ...values: unknown[]) => {
			const flat = flatten(values);
			queries.push({ values: flat });
			const filtered = flat.includes("topic-1");
			return (filtered ? results.withTopic : results.withoutTopic).map(hit);
		},
	};
	return { db: db as unknown as PrismaClient, queries };
};

const deps = (db: PrismaClient): Deps => ({
	llm: () => {
		throw new Error("retrieval must not call a model");
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

describe("retrieval widening", () => {
	test("a topic search that returns nothing is retried without the topic filter", async () => {
		const { db, queries } = dbDouble({
			withTopic: [],
			withoutTopic: ["a", "b", "c"],
		});
		const retrieved = await retrieve(input, confident, deps(db));

		expect(retrieved.widened).toBe(true);
		expect(retrieved.exemplars.map((e) => e.id)).toEqual(["a", "b", "c"]);
		expect(queries).toHaveLength(2);
		expect(queries[0]?.values).toContain("topic-1");
		expect(queries[1]?.values).not.toContain("topic-1");
	});

	test("one exemplar is too thin and also widens", async () => {
		const { db, queries } = dbDouble({
			withTopic: ["only"],
			withoutTopic: ["a", "b"],
		});
		const retrieved = await retrieve(input, confident, deps(db));

		expect(retrieved.widened).toBe(true);
		expect(queries).toHaveLength(2);
	});

	test("two exemplars are enough, and the topic filter stays on", async () => {
		const { db, queries } = dbDouble({
			withTopic: ["a", "b"],
			withoutTopic: ["x", "y", "z"],
		});
		const retrieved = await retrieve(input, confident, deps(db));

		expect(retrieved.widened).toBe(false);
		expect(retrieved.exemplars.map((e) => e.id)).toEqual(["a", "b"]);
		expect(queries).toHaveLength(1);
	});

	test("the widened search still filters by subject", async () => {
		const { db, queries } = dbDouble({ withTopic: [], withoutTopic: ["a"] });
		await retrieve(input, confident, deps(db));

		// Both searches carry it. Dropping the subject filter is the confidently-wrong
		// failure the whole retrieval contract exists to prevent.
		for (const query of queries) expect(query.values).toContain("subject-1");
	});

	test("an unconfident topic never filtered, so it never widens", async () => {
		const { db, queries } = dbDouble({ withTopic: [], withoutTopic: [] });
		const retrieved = await retrieve(
			input,
			{ kind: "educational", topic: null, confidence: 0 },
			deps(db),
		);

		expect(retrieved.widened).toBe(false);
		expect(queries).toHaveLength(1);
	});
});
