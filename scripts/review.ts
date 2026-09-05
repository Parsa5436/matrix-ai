// Build the teacher review document: 20 real questions, each answered by the system with
// its own exemplar held out, laid out one per page for him to mark with a pen.
//
//   bun run review                     write content/derived/teacher-review.pdf
//   bun run review --seed 7            a different, still reproducible sample
//   bun run review --chrome <path>     if Chrome is somewhere unusual
//
// He must never see JSON, LaTeX source, an id, or an English label — only the question and
// the answer as a student would get it, plus two boxes to tick.
//
// Rendered through headless Chrome rather than a PDF library: Persian needs bidi and
// Arabic-script shaping, and the maths needs typesetting. reportlab does neither. KaTeX is
// rendered to static HTML here, so the page needs no JavaScript at print time, and
// puppeteer-core drives a Chrome that is already installed — nothing is downloaded at
// install or build time, which matters on the target network.

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import puppeteer from "puppeteer-core";
import { embedQuery } from "@/lib/ai/embed";
import { languageModel } from "@/lib/ai/provider";
import { answer } from "@/lib/answer/pipeline";
import { canonicalTopic } from "@/lib/answer/topics";
import { prisma } from "@/lib/db/client";
import { getActiveCorpusVersion } from "@/lib/db/corpus";
import { normalizePersian } from "@/lib/knowledge/normalize";
import { asAsked, cleanOptions } from "@/lib/knowledge/options";
import {
	persianInlineToHtml,
	persianMarkdownToHtml,
} from "@/lib/knowledge/persian-markdown";
import { toPersianDigits } from "@/lib/persian";

const OUT_PDF = resolve("content/derived/teacher-review.pdf");
const OUT_HTML = resolve("content/derived/teacher-review.html");
const EXTRACTION = resolve("content/derived/chapter-1.extraction.json");
const VISION_SET = resolve("evals/physics-10-vision.json");
const FONT = resolve("app/fonts/Vazirmatn-Variable.woff2");
const KATEX_CSS = resolve("node_modules/katex/dist/katex.min.css");
const SAMPLE_SIZE = 20;

const CHROME_CANDIDATES = [
	"C:/Program Files/Google/Chrome/Application/chrome.exe",
	"C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
	"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
	"C:/Program Files/Microsoft/Edge/Application/msedge.exe",
];

const arg = (name: string) => {
	const i = process.argv.indexOf(`--${name}`);
	return i >= 0 ? process.argv[i + 1] : undefined;
};

const seed = Number(arg("seed") ?? 1);

// Deterministic so the same twenty come out every run and a reviewer can be sent "the same
// document again" without it silently being a different sample.
function mulberry32(a: number) {
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const shuffle = <T>(items: T[], rng: () => number) => {
	const out = [...items];
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[out[i], out[j]] = [out[j] as T, out[i] as T];
	}
	return out;
};

// ── data ─────────────────────────────────────────────────────────────────────
const corpusVersion = await getActiveCorpusVersion(prisma);
const rows = await prisma.exemplar.findMany({
	where: { corpusVersion },
	include: { topic: true, subject: true },
	orderBy: { id: "asc" },
});
if (rows.length === 0) {
	console.error(
		`No exemplars in corpusVersion ${corpusVersion}. Run corpus:activate first.`,
	);
	process.exit(1);
}

// The slide page is not on the row, but the extraction cache is keyed by it — and the page
// number is the only thing that lets him find what he actually wrote.
const cache: Record<string, { question?: string | null }> = JSON.parse(
	await readFile(EXTRACTION, "utf8").catch(() => "{}"),
);
const pageByQuestion = new Map<string, number>();
for (const [page, slide] of Object.entries(cache)) {
	const q = slide.question?.trim();
	if (q && !pageByQuestion.has(normalizePersian(q))) {
		pageByQuestion.set(normalizePersian(q), Number(page));
	}
}
const slidePage = (question: string) =>
	pageByQuestion.get(normalizePersian(question)) ?? null;

// ── sample: twenty, spread across topics ─────────────────────────────────────
// Round-robin across topics rather than a flat shuffle. چگالی holds far more exemplars than
// any other topic and a flat sample would hand him a document that is half density.
const rng = mulberry32(seed);
const byTopic = new Map<string, typeof rows>();
for (const row of rows) {
	const topic = canonicalTopic(row.topic.title) ?? "بدون موضوع";
	byTopic.set(topic, [...(byTopic.get(topic) ?? []), row]);
}
// Questions that cannot be answered without seeing the slide. Sending him one is asking him
// to grade a failure we already know about and have scheduled. The list is the eval's own
// vision set, so it stays in step with `eval --build` rather than being a second copy.
const visionIds = new Set<string>(
	(
		JSON.parse(await readFile(VISION_SET, "utf8").catch(() => "{}")) as {
			cases?: { exemplarId: string }[];
		}
	).cases?.map((c) => c.exemplarId) ?? [],
);

// Shuffled first, filtered second. Filtering the pool up front would consume different
// random draws and silently produce a completely different twenty — and the teacher has
// already marked this one by hand.
const queues = shuffle([...byTopic.entries()], rng).map(
	([topic, items]) =>
		[topic, shuffle(items, rng).filter((r) => !visionIds.has(r.id))] as const,
);

const picked: { topic: string; row: (typeof rows)[number] }[] = [];
for (
	let round = 0;
	picked.length < Math.min(SAMPLE_SIZE, rows.length);
	round++
) {
	let tookAny = false;
	for (const [topic, queue] of queues) {
		if (picked.length >= SAMPLE_SIZE) break;
		const row = queue[round];
		if (!row) continue;
		picked.push({ topic, row });
		tookAny = true;
	}
	if (!tookAny) break;
}

// ── answer each, with its own exemplar held out ──────────────────────────────
const deps = { llm: languageModel, embed: embedQuery, db: prisma };
type Item = {
	topic: string;
	page: number | null;
	question: string;
	options: string[];
	answerMd: string;
};

console.log(`answering ${picked.length} question(s)...`);
const items: Item[] = [];
for (const [index, { topic, row }] of picked.entries()) {
	// The stored options still carry the label the extraction fused into them; he must see
	// «۸», not «۸ ۱». Cleaned once, then both printed and asked, so the page he marks and
	// the question the model saw cannot drift apart.
	const options = Array.isArray(row.options)
		? cleanOptions(row.options as string[])
		: [];

	let answerMd = "";
	for await (const chunk of answer(
		{
			question: asAsked({ question: row.question, options }),
			subjectId: row.subjectId,
			history: [],
		},
		deps,
		// Held out: showing the system its own worked solution would make the review prove
		// nothing at all.
		{ excludeExemplarIds: [row.id] },
	)) {
		if (chunk.type === "text") answerMd += chunk.delta;
	}
	items.push({
		topic,
		page: slidePage(row.question),
		question: row.question,
		options,
		answerMd,
	});
	process.stdout.write(`  ${index + 1}/${picked.length}\r`);
}
console.log();

// ── document ─────────────────────────────────────────────────────────────────
const fontDataUri = `data:font/woff2;base64,${(await readFile(FONT)).toString("base64")}`;

const page = (item: Item, index: number) => `
<section class="item">
  <header>
    <span class="page">اسلاید شماره ${item.page === null ? "—" : item.page + 1}</span>
    <span class="topic">${item.topic}</span>
    <span class="count">${index + 1} از ${items.length}</span>
  </header>

  <h2>سؤال</h2>
  <div class="question">${persianMarkdownToHtml(item.question)}</div>
  ${
		item.options.length
			? `<div class="options">${item.options
					.map(
						(o, i) =>
							`<div class="option"><span class="label">${toPersianDigits(String(i + 1))})</span> ${persianInlineToHtml(o)}</div>`,
					)
					.join("")}</div>`
			: ""
	}

  <hr>

  <h2>پاسخ سامانه</h2>
  <div class="answer">${persianMarkdownToHtml(item.answerMd)}</div>

  <hr>

  <div class="verdict">
    <p class="ask">آیا این همان روشی است که شما حل کردید؟
      <span class="box">☐ بله</span>
      <span class="box">☐ خیر</span>
    </p>
    <p class="ask">اگر خیر، کجا فرق دارد؟</p>
    <div class="rule"></div>
    <div class="rule"></div>
  </div>
</section>`;

const html = `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<title>بازبینی روش تدریس</title>
<link rel="stylesheet" href="${pathToFileURL(KATEX_CSS).href}">
<style>
  @font-face {
    font-family: "Vazirmatn";
    src: url("${fontDataUri}") format("woff2");
    font-weight: 100 900;
    font-display: block;
  }
  @page { size: A4; margin: 11mm 13mm; }
  * { box-sizing: border-box; }
  body {
    font-family: "Vazirmatn", sans-serif;
    font-size: 9.5pt; line-height: 1.55; color: #111; margin: 0;
  }
  .item { page-break-after: always; }
  .item:last-child { page-break-after: auto; }
  header {
    display: flex; justify-content: space-between; align-items: baseline;
    border-bottom: 2px solid #111; padding-bottom: 4px; margin-bottom: 9px;
    font-size: 9pt;
  }
  .page { font-weight: 700; }
  .topic { color: #444; }
  .count { color: #888; }
  h2 { font-size: 9.5pt; margin: 0 0 4px; color: #333; }
  .question { font-weight: 500; }
  p { margin: 0 0 4px; }
  .options { margin: 5px 0 0; }
  .option { margin-bottom: 2px; }
  .option .label { font-weight: 700; margin-inline-end: 4px; }
  hr { border: 0; border-top: 1px dashed #bbb; margin: 9px 0; }
  .answer { font-size: 9.5pt; }
  .math { display: inline-block; }
  .math.display { display: block; margin: 3px 0; text-align: center; }
  .verdict { margin-top: 12px; }
  .ask { font-weight: 600; }
  .box { display: inline-block; margin-inline-start: 18px; font-weight: 400; }
  .rule { border-bottom: 1px solid #999; height: 22px; margin-top: 6px; }
</style>
</head>
<body>
${items.map(page).join("\n")}
</body>
</html>`;

await writeFile(OUT_HTML, html);

const executablePath =
	arg("chrome") ??
	(await (async () => {
		for (const candidate of CHROME_CANDIDATES) {
			if (
				await readFile(candidate)
					.then(() => true)
					.catch(() => false)
			)
				return candidate;
		}
		return undefined;
	})());

if (!executablePath) {
	console.error(
		`No Chrome or Edge found. Pass one with --chrome <path>.\nThe HTML is written to ${OUT_HTML} and prints correctly from any browser.`,
	);
	await prisma.$disconnect();
	process.exit(1);
}

const browser = await puppeteer.launch({ executablePath, headless: true });
const tab = await browser.newPage();
await tab.goto(pathToFileURL(OUT_HTML).href, { waitUntil: "networkidle0" });
await tab.pdf({ path: OUT_PDF, format: "A4", printBackground: true });
await browser.close();

// ── summary, for cross-checking against the deck ─────────────────────────────
console.log(`\n--- teacher review: ${items.length} item(s), seed ${seed} ---`);
console.log(`${"#".padEnd(4)}${"slide".padEnd(8)}topic`);
for (const [i, item] of items.entries()) {
	const page = item.page === null ? "—" : String(item.page + 1);
	console.log(`${String(i + 1).padEnd(4)}${page.padEnd(8)}${item.topic}`);
}

const distribution = new Map<string, number>();
for (const item of items)
	distribution.set(item.topic, (distribution.get(item.topic) ?? 0) + 1);
console.log("\ntopic distribution:");
for (const [topic, n] of [...distribution].sort((a, b) => b[1] - a[1])) {
	console.log(`  ${String(n).padStart(2)}  ${topic}`);
}
const missing = items.filter((i) => i.page === null).length;
if (missing)
	console.log(`\n${missing} item(s) could not be matched to a slide page`);
console.log(`\npdf   ${OUT_PDF}`);
console.log(`html  ${OUT_HTML}`);

await prisma.$disconnect();
