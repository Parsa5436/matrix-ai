import pgvector from "pgvector";
import { z } from "zod";
import { VectorHitSchema } from "@/lib/ai/schemas";
import type { PrismaClient } from "./generated/client";
import { Prisma } from "./generated/client";

// The only file in the codebase with hand-written SQL. It returns ids and scores; the
// caller hydrates rows through Prisma, so nothing else has to reason about SQL types.

export type SearchArgs = {
	queryText: string;
	queryEmbedding: number[];
	subjectId: string;
	corpusVersion: number;
	topicIds?: string[];
	limit?: number;
};

const HitsSchema = z.array(VectorHitSchema);

// Reciprocal rank fusion. k=60 is the usual constant; it damps the head of each list so
// one strong lexical hit cannot outvote a consistently good vector ranking.
const RRF_K = 60;
const CANDIDATES = 50;

function search(
	prisma: PrismaClient,
	table: "Chunk" | "Exemplar",
	textColumn: "contentNorm" | "questionNorm",
	{
		queryText,
		queryEmbedding,
		subjectId,
		corpusVersion,
		topicIds,
		limit = 15,
	}: SearchArgs,
) {
	const relation = Prisma.raw(`"${table}"`);
	const textCol = Prisma.raw(`"${textColumn}"`);
	// Subject and version are never optional — an unfiltered vector scan is how a physics
	// question comes back with a maths exemplar, confidently and with no error.
	const topicFilter =
		topicIds && topicIds.length > 0
			? Prisma.sql`AND "topicId" IN (${Prisma.join(topicIds)})`
			: Prisma.empty;
	const vector = pgvector.toSql(queryEmbedding);

	return prisma.$queryRaw`
		WITH lexical AS (
			SELECT id, row_number() OVER (
				ORDER BY ts_rank(to_tsvector('simple', ${textCol}), plainto_tsquery('simple', ${queryText})) DESC
			) AS rank
			FROM ${relation}
			WHERE "subjectId" = ${subjectId}
				AND "corpusVersion" = ${corpusVersion}
				${topicFilter}
				AND to_tsvector('simple', ${textCol}) @@ plainto_tsquery('simple', ${queryText})
			LIMIT ${CANDIDATES}
		),
		semantic AS (
			SELECT id, row_number() OVER (ORDER BY embedding <=> ${vector}::vector) AS rank
			FROM ${relation}
			WHERE "subjectId" = ${subjectId}
				AND "corpusVersion" = ${corpusVersion}
				${topicFilter}
				AND embedding IS NOT NULL
			ORDER BY embedding <=> ${vector}::vector
			LIMIT ${CANDIDATES}
		)
		SELECT COALESCE(lexical.id, semantic.id) AS id,
			COALESCE(1.0 / (${RRF_K} + lexical.rank), 0)
			+ COALESCE(1.0 / (${RRF_K} + semantic.rank), 0) AS score
		FROM lexical FULL OUTER JOIN semantic ON lexical.id = semantic.id
		ORDER BY score DESC
		LIMIT ${limit}
	`;
}

// $queryRaw is untyped and the numeric columns arrive as strings or Decimals depending on
// the driver, so this is the boundary where the result becomes trustworthy.
async function toHits(rows: Promise<unknown>) {
	const parsed = HitsSchema.safeParse(
		((await rows) as { id: string; score: unknown }[]).map((r) => ({
			id: r.id,
			score: Number(r.score),
		})),
	);
	if (!parsed.success) {
		throw new Error(
			`vector search returned an unexpected shape: ${z.prettifyError(parsed.error)}`,
		);
	}
	return parsed.data;
}

export const searchExemplars = (prisma: PrismaClient, args: SearchArgs) =>
	toHits(search(prisma, "Exemplar", "questionNorm", args));
