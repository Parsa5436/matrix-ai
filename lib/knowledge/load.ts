import { randomUUID } from "node:crypto";
import { generateText } from "ai";
import pgvector from "pgvector";
import { embedPassages } from "@/lib/ai/embed";
import { METHOD_CARD_INSTRUCTIONS } from "@/lib/ai/prompts";
import type { Deps } from "@/lib/answer/types";
import type { PrismaClient } from "@/lib/db/generated/client";
import { normalizePersian } from "./normalize";

// The shared tail of every ingest: normalize, embed, insert the row and its vector in one
// statement, draft the method cards, record the flags. Two front-ends feed it — markdown
// notes and the slide deck — and the parts they share are exactly the parts that are subtle
// enough to drift apart if they were copied. Normalization lives here for the same reason:
// there is then one place on the write side that can disagree with query time, and it is
// this one.

export type PendingChunk = {
	topicId: string;
	source: string;
	content: string;
};

export type PendingExemplar = {
	topicId: string;
	question: string;
	options: string[] | null;
	answer: string;
	solutionMd: string;
	methodTags: string[];
	difficulty: number | null;
};

export type PendingFlag = {
	kind: string;
	reason: string;
	rawText: string;
	sourcePath: string;
};

export type TopicMaterial = { title: string; text: string[] };

export type LoadInput = {
	subjectId: string;
	corpusVersion: number;
	chunks: PendingChunk[];
	exemplars: PendingExemplar[];
	flags: PendingFlag[];
	/** topicId -> the teacher's own material for that topic, used to draft the method card */
	topicMaterial: Map<string, TopicMaterial>;
};

export type LoadCounts = {
	written: number;
	flagged: number;
	methodCards: number;
};

export async function loadCorpus(
	prisma: PrismaClient,
	deps: Pick<Deps, "llm">,
	input: LoadInput,
): Promise<LoadCounts> {
	const { subjectId, corpusVersion, chunks, exemplars, flags, topicMaterial } =
		input;

	const chunkRows = chunks.map((c) => ({
		...c,
		id: randomUUID(),
		contentNorm: normalizePersian(c.content),
	}));
	const exemplarRows = exemplars.map((e) => ({
		...e,
		id: randomUUID(),
		questionNorm: normalizePersian(e.question),
	}));

	console.log(
		`embedding ${chunkRows.length} chunk(s) and ${exemplarRows.length} exemplar(s)...`,
	);
	const chunkVectors = await embedPassages(chunkRows.map((c) => c.contentNorm));
	const exemplarVectors = await embedPassages(
		exemplarRows.map((e) => e.questionNorm),
	);

	let written = 0;

	for (const [index, chunk] of chunkRows.entries()) {
		const vector = chunkVectors[index];
		if (!vector) throw new Error(`missing embedding for chunk ${chunk.id}`);
		await prisma.$executeRaw`
			INSERT INTO "Chunk" (id, "topicId", "subjectId", "corpusVersion", source, content, "contentNorm", embedding)
			VALUES (${chunk.id}, ${chunk.topicId}, ${subjectId}, ${corpusVersion}, ${chunk.source},
				${chunk.content}, ${chunk.contentNorm}, ${pgvector.toSql(vector)}::vector)
		`;
		written++;
	}

	for (const [index, exemplar] of exemplarRows.entries()) {
		const vector = exemplarVectors[index];
		if (!vector)
			throw new Error(`missing embedding for exemplar ${exemplar.id}`);
		await prisma.$executeRaw`
			INSERT INTO "Exemplar" (id, "topicId", "subjectId", "corpusVersion", question, "questionNorm",
				options, answer, "solutionMd", "methodTags", difficulty, embedding)
			VALUES (${exemplar.id}, ${exemplar.topicId}, ${subjectId}, ${corpusVersion}, ${exemplar.question},
				${exemplar.questionNorm},
				${exemplar.options ? JSON.stringify(exemplar.options) : null}::jsonb,
				${exemplar.answer}, ${exemplar.solutionMd}, ${exemplar.methodTags}, ${exemplar.difficulty},
				${pgvector.toSql(vector)}::vector)
		`;
		written++;
	}

	// Drafted, never approved. Retrieval must not use one until a teacher has read it, which
	// is what teacherApproved guards; there is no approval UI on purpose.
	console.log(`drafting ${topicMaterial.size} method card(s)...`);
	let methodCards = 0;
	for (const [topicId, material] of topicMaterial) {
		if (material.text.length === 0) continue;
		const { text } = await generateText({
			model: deps.llm("fast"),
			instructions: METHOD_CARD_INSTRUCTIONS,
			prompt: `موضوع: ${material.title}\n\n${material.text.join("\n\n")}`,
		});
		await prisma.methodCard.create({
			data: {
				topicId,
				corpusVersion,
				contentMd: text.trim(),
				teacherApproved: false,
			},
		});
		methodCards++;
	}

	if (flags.length > 0) {
		await prisma.ingestFlag.createMany({
			data: flags.map((f) => ({ ...f, corpusVersion })),
		});
	}

	return { written, flagged: flags.length, methodCards };
}
