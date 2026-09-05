// Flip the active corpus pointer. Separate from ingest on purpose: a corpus goes live
// because a human verified it, not because a script finished.
//
//   bun run corpus:activate 3

import { prisma } from "@/lib/db/client";
import {
	getActiveCorpusVersion,
	setActiveCorpusVersion,
} from "@/lib/db/corpus";

const requested = Number(process.argv[2]);
if (!Number.isInteger(requested) || requested < 1) {
	console.error("Usage: bun run corpus:activate <version>");
	process.exit(1);
}

const [chunks, exemplars] = await Promise.all([
	prisma.chunk.count({ where: { corpusVersion: requested } }),
	prisma.exemplar.count({ where: { corpusVersion: requested } }),
]);

if (chunks + exemplars === 0) {
	console.error(
		`corpusVersion ${requested} holds no rows. Refusing to activate an empty corpus.`,
	);
	process.exit(1);
}

const previous = await getActiveCorpusVersion(prisma);
await setActiveCorpusVersion(prisma, requested);
console.log(
	`active corpusVersion ${previous} -> ${requested} (${chunks} chunk(s), ${exemplars} exemplar(s))`,
);

await prisma.$disconnect();
