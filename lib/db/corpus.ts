import type { PrismaClient } from "./generated/client";

const ACTIVE_KEY = "activeCorpusVersion";

// Retrieval reads this on every query; ingest writes a new version beside the old one and
// only flips the pointer once the run is verified. Rollback is this one UPDATE.
export async function getActiveCorpusVersion(
	prisma: PrismaClient,
): Promise<number> {
	const row = await prisma.setting.findUnique({ where: { key: ACTIVE_KEY } });
	return row ? Number(row.value) : 0;
}

export async function setActiveCorpusVersion(
	prisma: PrismaClient,
	version: number,
): Promise<void> {
	await prisma.setting.upsert({
		where: { key: ACTIVE_KEY },
		create: { key: ACTIVE_KEY, value: String(version) },
		update: { value: String(version) },
	});
}

// One past the highest version any knowledge row carries — never a TRUNCATE, never a
// reuse of a live version.
export async function nextCorpusVersion(prisma: PrismaClient): Promise<number> {
	const [chunk, exemplar] = await Promise.all([
		prisma.chunk.aggregate({ _max: { corpusVersion: true } }),
		prisma.exemplar.aggregate({ _max: { corpusVersion: true } }),
	]);
	const highest = Math.max(
		chunk._max.corpusVersion ?? 0,
		exemplar._max.corpusVersion ?? 0,
	);
	return highest + 1;
}
