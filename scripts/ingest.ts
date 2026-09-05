// Corpus ingestion. A CLI, never a route — a route times out halfway through and leaves
// half a corpus behind. Writes a NEW corpusVersion beside the existing one; retrieval
// keeps serving the old version until the pointer is flipped.
//
//   bun run ingest                      ingest into a new version, leave it inactive
//   bun run ingest --activate           ingest and make it live
//   bun run ingest --dir other/content  ingest from somewhere else
//
// The only thing the real corpus changes is --dir.

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import katex from "katex";
import { z } from "zod";
import { generateJson, JsonExtractionError } from "@/lib/ai/json";
import { EXTRACT_EXEMPLAR_INSTRUCTIONS } from "@/lib/ai/prompts";
import { languageModel } from "@/lib/ai/provider";
import { ExtractedExemplarSchema } from "@/lib/ai/schemas";
import { prisma } from "@/lib/db/client";
import { nextCorpusVersion, setActiveCorpusVersion } from "@/lib/db/corpus";
import { extractFormulas, parseMarkdown } from "@/lib/knowledge/chunk";
import {
	loadCorpus,
	type PendingChunk,
	type PendingExemplar,
	type TopicMaterial,
} from "@/lib/knowledge/load";

const ManifestSchema = z.object({
	subject: z.string().min(1),
	teacher: z.object({
		name: z.string().min(1),
		personaPrompt: z.string().min(1),
	}),
	files: z.array(z.string().min(1)).min(1),
});

const deps = { llm: languageModel };

const args = process.argv.slice(2);
const activate = args.includes("--activate");
const dirFlag = args.indexOf("--dir");
const contentDir = resolve(
	dirFlag >= 0 ? (args[dirFlag + 1] ?? "content") : "content",
);

const counts = { written: 0, flagged: 0, badFormulas: 0 };
const flags: {
	kind: string;
	reason: string;
	rawText: string;
	sourcePath: string;
}[] = [];

const flag = (
	kind: string,
	reason: string,
	rawText: string,
	sourcePath: string,
) => {
	flags.push({ kind, reason, rawText, sourcePath });
	if (kind === "formula") counts.badFormulas++;
	else counts.flagged++;
};

// 1. manifest
const manifestRaw = await readFile(
	join(contentDir, "manifest.json"),
	"utf8",
).catch(() => null);
if (!manifestRaw) {
	console.error(
		`No manifest.json under ${contentDir}. See content/manifest.json for the shape.`,
	);
	process.exit(1);
}
const manifest = ManifestSchema.parse(JSON.parse(manifestRaw));
const sources = await Promise.all(
	manifest.files.map(async (file) => ({
		path: file,
		markdown: await readFile(join(contentDir, file), "utf8"),
	})),
);

// 2. Validate the maths before anything else. A cleanup model can produce LaTeX that is
// valid-but-wrong and nothing downstream notices: the answer model reads the broken
// formula and solves it correctly. Compiling every formula catches the damage that does
// throw, and it is cheap.
console.log("validating formulas...");
for (const { path, markdown } of sources) {
	for (const formula of extractFormulas(markdown)) {
		try {
			katex.renderToString(formula, { throwOnError: true });
		} catch (error) {
			flag(
				"formula",
				error instanceof Error ? error.message : String(error),
				formula,
				path,
			);
		}
	}
}
console.log(`  ${counts.badFormulas} formula(s) failed to compile`);

// 3. taxonomy
const version = await nextCorpusVersion(prisma);
console.log(`ingesting into corpusVersion ${version}`);

const subject = await prisma.subject.upsert({
	where: { title: manifest.subject },
	create: { title: manifest.subject },
	update: {},
});
const teacher = await prisma.teacher.upsert({
	where: { name: manifest.teacher.name },
	create: manifest.teacher,
	update: { personaPrompt: manifest.teacher.personaPrompt },
});

const pendingChunks: PendingChunk[] = [];
const pendingExemplars: PendingExemplar[] = [];
const topicMaterial = new Map<string, TopicMaterial>();

for (const { path, markdown } of sources) {
	for (const parsed of parseMarkdown(markdown)) {
		const chapter = await prisma.chapter.upsert({
			where: {
				subjectId_title: { subjectId: subject.id, title: parsed.chapterTitle },
			},
			create: {
				subjectId: subject.id,
				teacherId: teacher.id,
				title: parsed.chapterTitle,
				ord: 0,
			},
			update: {},
		});
		const topic = await prisma.topic.upsert({
			where: {
				chapterId_title: { chapterId: chapter.id, title: parsed.topicTitle },
			},
			create: { chapterId: chapter.id, title: parsed.topicTitle },
			update: {},
		});
		const material = topicMaterial.get(topic.id) ?? {
			title: parsed.topicTitle,
			text: [],
		};
		topicMaterial.set(topic.id, material);

		for (const content of parsed.chunks) {
			material.text.push(content);
			pendingChunks.push({ topicId: topic.id, source: "note", content });
		}

		// 4. Extract each solved problem, validated with Zod.
		for (const exemplar of parsed.exemplars) {
			const raw = `${exemplar.heading}\n\n${exemplar.body}`;
			try {
				const extracted = await generateJson(deps, {
					role: "fast",
					instructions: EXTRACT_EXEMPLAR_INSTRUCTIONS,
					prompt: raw,
					schema: ExtractedExemplarSchema,
				});
				material.text.push(`${extracted.question}\n${extracted.solutionMd}`);
				pendingExemplars.push({
					topicId: topic.id,
					question: extracted.question,
					options: extracted.options,
					answer: extracted.answer,
					solutionMd: extracted.solutionMd,
					methodTags: extracted.methodTags,
					difficulty: extracted.difficulty,
				});
			} catch (error) {
				// Flagged for a human, never dropped. A silently skipped problem is a hole in
				// the corpus that nobody finds until a student asks about it.
				const reason =
					error instanceof JsonExtractionError ? error.message : String(error);
				flag("schema", reason, raw, path);
			}
		}
	}
}

// 5-7. Embed, insert, draft the method cards and record the flags. Shared with the slide
// ingest so the two front-ends cannot drift apart on the parts that are easy to get subtly
// wrong — the vector insert and the normalization that has to match query time.
const loaded = await loadCorpus(prisma, deps, {
	subjectId: subject.id,
	corpusVersion: version,
	chunks: pendingChunks,
	exemplars: pendingExemplars,
	flags,
	topicMaterial,
});
counts.written = loaded.written;

if (activate) await setActiveCorpusVersion(prisma, version);

console.log("\n--- ingest report ---");
console.log(
	`corpusVersion        ${version}${activate ? " (now active)" : " (inactive)"}`,
);
console.log(`rows written         ${counts.written}`);
console.log(`rows flagged         ${counts.flagged}`);
console.log(`formulas failed      ${counts.badFormulas}`);
for (const f of flags) {
	console.log(`  [${f.kind}] ${f.sourcePath}: ${f.reason.slice(0, 110)}`);
}
if (!activate) {
	console.log(
		`\nnot live yet. verify, then flip the pointer with: bun run corpus:activate ${version}`,
	);
}

await prisma.$disconnect();
