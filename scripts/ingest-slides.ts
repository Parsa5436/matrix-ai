// Extract the chapter-1 corpus from the merged slide deck.
//
//   bun run ingest:slides              extract and load into a new, inactive corpusVersion
//   bun run ingest:slides --refresh    ignore the extraction cache and re-call the model
//
// The slide page is the chunk boundary here; the markdown splitter does not apply. Every
// page gets exactly one VLM call, and every result is cross-checked against the ink oracle
// — a pixel measure with no model in it. The model cannot talk its way past a pixel count,
// which is the only reason we can trust handwriting we did not read ourselves.

import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import * as mupdf from "mupdf";
import { z } from "zod";
import { generateJson, JsonExtractionError } from "@/lib/ai/json";
import { EXTRACT_SLIDE_INSTRUCTIONS } from "@/lib/ai/prompts";
import { languageModel } from "@/lib/ai/provider";
import { type ExtractedSlide, ExtractedSlideSchema } from "@/lib/ai/schemas";
import { prisma } from "@/lib/db/client";
import { nextCorpusVersion } from "@/lib/db/corpus";
import { INK_HEAVY, INK_PRESENT } from "@/lib/knowledge/ink";
import {
	loadCorpus,
	type PendingChunk,
	type PendingExemplar,
	type PendingFlag,
	type TopicMaterial,
} from "@/lib/knowledge/load";
import { normalizePersian } from "@/lib/knowledge/normalize";

const DIR = resolve("content/derived");
const DECK = join(DIR, "chapter-1.pdf");
const MANIFEST = join(DIR, "chapter-1.manifest.json");
const CACHE = join(DIR, "chapter-1.extraction.json");

// From the booklet, which is the only place the course names itself. Everything else it
// contains is the unfilled skeleton and is deliberately ignored.
const SUBJECT = "فیزیک دهم";
const TEACHER = "استاد مهدی یحیوی";
const TEACHER_PERSONA =
	"دبیر فیزیک پایه دهم. روش خودش را روی اسلاید می‌نویسد: اول یکا و صورت مسئله را مشخص می‌کند، بعد جدول تناسب یا رابطه را می‌نویسد و مرحله‌به‌مرحله جلو می‌رود.";
const CHAPTER = "فصل اول";

const RENDER_SCALE = 1.6; // ~115 dpi — enough for handwriting without oversized payloads
const CONCURRENCY = 4;

const refresh = process.argv.includes("--refresh");

const ManifestSchema = z.object({
	pageCount: z.number().int().positive(),
	pages: z.array(
		z.object({
			page: z.number().int().nonnegative(),
			source: z.string(),
			ink: z.number(),
		}),
	),
});

const manifest = ManifestSchema.parse(
	JSON.parse(
		await readFile(MANIFEST, "utf8").catch(() => {
			console.error(`Missing ${MANIFEST}. Run \`bun run deck:build\` first.`);
			process.exit(1);
		}),
	),
);

const deck = mupdf.Document.openDocument(
	await readFile(DECK),
	"application/pdf",
) as mupdf.PDFDocument;

const renderPage = (index: number) => {
	const pixmap = deck
		.loadPage(index)
		.toPixmap(
			mupdf.Matrix.scale(RENDER_SCALE, RENDER_SCALE),
			mupdf.ColorSpace.DeviceRGB,
			false,
		);
	const png = pixmap.asPNG();
	pixmap.destroy();
	return png;
};

// ── extract ──────────────────────────────────────────────────────────────────
const cached: Record<string, ExtractedSlide> = refresh
	? {}
	: JSON.parse(await readFile(CACHE, "utf8").catch(() => "{}"));

const deps = { llm: languageModel };
const slides = new Map<number, ExtractedSlide>();
const flags: PendingFlag[] = [];

const extractPage = async (page: number) => {
	const hit = cached[String(page)];
	if (hit) {
		slides.set(page, hit);
		return;
	}
	try {
		const slide = await generateJson(deps, {
			role: "reasoning",
			instructions: EXTRACT_SLIDE_INSTRUCTIONS,
			prompt: `Slide ${page + 1} of ${manifest.pageCount} from «${CHAPTER}».`,
			schema: ExtractedSlideSchema,
			image: { data: renderPage(page), mediaType: "image/png" },
		});
		slides.set(page, slide);
	} catch (error) {
		flags.push({
			kind: "schema",
			reason:
				error instanceof JsonExtractionError ? error.message : String(error),
			rawText:
				error instanceof JsonExtractionError ? error.raw.slice(0, 4000) : "",
			sourcePath: `chapter-1.pdf#p${page}`,
		});
	}
};

// --limit exists so the extraction path can be smoke-tested on a handful of pages before
// committing to a full run; the cache means a partial run is never wasted.
const limitFlag = process.argv.indexOf("--limit");
const limit =
	limitFlag >= 0
		? Number(process.argv[limitFlag + 1])
		: Number.POSITIVE_INFINITY;

console.log(
	`extracting ${manifest.pageCount} slides (concurrency ${CONCURRENCY})...`,
);
const pageNumbers = manifest.pages.map((p) => p.page).slice(0, limit);
for (let i = 0; i < pageNumbers.length; i += CONCURRENCY) {
	await Promise.all(pageNumbers.slice(i, i + CONCURRENCY).map(extractPage));
	process.stdout.write(
		`  ${Math.min(i + CONCURRENCY, pageNumbers.length)}/${pageNumbers.length}\r`,
	);
}
console.log();

await writeFile(
	CACHE,
	`${JSON.stringify(Object.fromEntries(slides), null, 2)}\n`,
);

// ── cross-check against the oracle ───────────────────────────────────────────
// Two failures, each caught by the pixels rather than by the model's own confidence.
const MEANINGFUL = 12; // characters of handwriting below which the page is effectively blank

let hallucinations = 0;
let extractionFailures = 0;

for (const entry of manifest.pages) {
	const slide = slides.get(entry.page);
	if (!slide) continue;
	const wrote = slide.handwriting.trim().length;
	const claims = wrote >= MEANINGFUL || slide.methodSteps.length > 0;

	if (claims && entry.ink < INK_PRESENT) {
		hallucinations++;
		flags.push({
			kind: "hallucination",
			reason: `model reported handwriting on a page the ink oracle scores clean (ink=${entry.ink}, threshold=${INK_PRESENT})`,
			rawText: slide.handwriting.slice(0, 2000),
			sourcePath: `chapter-1.pdf#p${entry.page}`,
		});
	}

	if (!claims && entry.ink >= INK_HEAVY) {
		extractionFailures++;
		flags.push({
			kind: "extraction",
			reason: `ink oracle scores this page heavily annotated (ink=${entry.ink}) but the model returned no handwriting`,
			rawText: slide.printedText.slice(0, 2000),
			sourcePath: `chapter-1.pdf#p${entry.page}`,
		});
	}
}

// ── build records ────────────────────────────────────────────────────────────
const subject = await prisma.subject.upsert({
	where: { title: SUBJECT },
	create: { title: SUBJECT },
	update: {},
});
const teacher = await prisma.teacher.upsert({
	where: { name: TEACHER },
	create: { name: TEACHER, personaPrompt: TEACHER_PERSONA },
	update: { personaPrompt: TEACHER_PERSONA },
});
const chapter = await prisma.chapter.upsert({
	where: { subjectId_title: { subjectId: subject.id, title: CHAPTER } },
	create: {
		subjectId: subject.id,
		teacherId: teacher.id,
		title: CHAPTER,
		ord: 1,
	},
	update: {},
});

// Topic titles come back per slide, so they are consolidated on the normalized form —
// otherwise «مدل‌سازی» and «مدل سازی» become two topics and the method cards fragment.
const topicIds = new Map<string, string>();
const topicMaterial = new Map<string, TopicMaterial>();

const topicFor = async (title: string) => {
	const key = normalizePersian(title);
	const existing = topicIds.get(key);
	if (existing) return existing;
	const topic = await prisma.topic.upsert({
		where: { chapterId_title: { chapterId: chapter.id, title } },
		create: { chapterId: chapter.id, title },
		update: {},
	});
	topicIds.set(key, topic.id);
	topicMaterial.set(topic.id, { title, text: [] });
	return topic.id;
};

const chunks: PendingChunk[] = [];
const exemplars: PendingExemplar[] = [];
let solvedWithoutAnswer = 0;

for (const entry of manifest.pages) {
	const slide = slides.get(entry.page);
	if (!slide) continue;
	const topicId = await topicFor(slide.topicTitle);
	const material = topicMaterial.get(topicId);
	const solved =
		slide.methodSteps.length > 0 ||
		slide.handwriting.trim().length >= MEANINGFUL;

	if (slide.question && solved) {
		const solutionMd =
			slide.methodSteps.length > 0
				? slide.methodSteps.map((s, i) => `${i + 1}. ${s}`).join("\n")
				: slide.handwriting;
		exemplars.push({
			topicId,
			question: slide.question,
			options: slide.options,
			answer: slide.markedAnswer ?? "",
			solutionMd,
			methodTags: [slide.slideKind],
			difficulty: null,
		});
		if (!slide.markedAnswer) solvedWithoutAnswer++;
		// Only the teacher's own material seeds a method card. Printed prose would drown it.
		material?.text.push(`${slide.question}\n${solutionMd}`);
		continue;
	}

	// Everything else is a chunk: printed lesson text, plus whatever he wrote onto it.
	const content = [slide.printedText.trim(), slide.handwriting.trim()]
		.filter(Boolean)
		.join("\n\n");
	if (content.length > 0) {
		chunks.push({ topicId, source: "note", content });
		if (solved) material?.text.push(slide.handwriting);
	}
}

// ── load ─────────────────────────────────────────────────────────────────────
const version = await nextCorpusVersion(prisma);
console.log(`loading into corpusVersion ${version}...`);

const counts = await loadCorpus(prisma, deps, {
	subjectId: subject.id,
	corpusVersion: version,
	chunks,
	exemplars,
	flags,
	topicMaterial,
});

// ── report ───────────────────────────────────────────────────────────────────
const extractedPages = manifest.pages.filter((p) => slides.has(p.page));
const withInk = extractedPages.filter((p) => p.ink >= INK_PRESENT).length;
const heavy = extractedPages.filter((p) => p.ink >= INK_HEAVY).length;
const extracted = slides.size;

console.log("\n--- slide ingest report ---");
console.log(`corpusVersion            ${version} (inactive)`);
console.log(`slides in deck           ${manifest.pageCount}`);
console.log(`slides extracted         ${extracted}`);
console.log(`pages with ink           ${withInk} (>= ${INK_PRESENT})`);
console.log(`pages heavily annotated  ${heavy} (>= ${INK_HEAVY})`);
console.log(`topics                   ${topicIds.size}`);
console.log(`exemplars                ${exemplars.length}`);
console.log(`chunks                   ${chunks.length}`);
console.log(
	`method cards             ${counts.methodCards} (all teacherApproved=false)`,
);
console.log(`rows written             ${counts.written}`);
console.log(`flags                    ${counts.flagged}`);
console.log(
	`  hallucination rate     ${hallucinations}/${extracted} (${((100 * hallucinations) / Math.max(extracted, 1)).toFixed(1)}%)`,
);
console.log(
	`  extraction-failure     ${extractionFailures}/${heavy} heavily-annotated pages (${((100 * extractionFailures) / Math.max(heavy, 1)).toFixed(1)}%)`,
);
console.log(`solved but no marked answer: ${solvedWithoutAnswer}`);
console.log(`\nextractions cached at ${CACHE}`);
console.log(`not live. after review:  bun run corpus:activate ${version}`);

await prisma.$disconnect();
