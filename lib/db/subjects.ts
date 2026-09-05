import { getActiveCorpusVersion } from "./corpus";
import type { PrismaClient } from "./generated/client";

// What the selector offers, read from the corpus rather than from a list in code: ingesting
// is then the whole deployment, and adding a subject stays data entry.
//
// Not to be confused with lib/answer/topics.ts, which maps the ingest's messy topic titles
// onto six canonical names. That is a naming table; this is the inventory.

export async function listSubjects(db: PrismaClient) {
	const corpusVersion = await getActiveCorpusVersion(db);
	return db.subject.findMany({
		// A Subject row with no live knowledge behind it is a half-finished ingest. Offering
		// it means a student picks it and silently gets the standard-method fallback.
		where: { exemplars: { some: { corpusVersion } } },
		select: { id: true, title: true },
		orderBy: { title: "asc" },
	});
}

export type SubjectOption = Awaited<ReturnType<typeof listSubjects>>[number];
