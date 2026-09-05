// The eval harness. Calls answer() directly — no HTTP, no route, no server.
//
//   bun run eval --build     regenerate evals/physics-10.json from the active corpus
//   bun run eval             score the committed set
//
// Three scores, kept separate on purpose. When an answer is wrong you need to know whether
// retrieval or generation broke, and a single accuracy number cannot tell you.
//
// Holdout: every question is built FROM an exemplar, so that exemplar is excluded from
// retrieval when its own question is asked (leave-one-out). Without this the model would be
// shown the answer it is being tested on.

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import * as mupdf from "mupdf";
import { z } from "zod";
import { embedQuery } from "@/lib/ai/embed";
import { languageModel } from "@/lib/ai/provider";
import { answer } from "@/lib/answer/pipeline";
import { canonicalTopic } from "@/lib/answer/topics";
import type { AnswerMode, SourceRef } from "@/lib/answer/types";
import { prisma } from "@/lib/db/client";
import { getActiveCorpusVersion } from "@/lib/db/corpus";
import { normalizePersian } from "@/lib/knowledge/normalize";
import { asAsked, cleanOption } from "@/lib/knowledge/options";
import { toPersianDigits } from "@/lib/persian";

const SET_PATH = resolve("evals/physics-10.json");
const DECK_PATH = resolve("content/derived/chapter-1.pdf");
const EXTRACTION_PATH = resolve("content/derived/chapter-1.extraction.json");
const CONCURRENCY = 4;

const CaseSchema = z.object({
	exemplarId: z.string().min(1),
	question: z.string().min(5),
	options: z.array(z.string()),
	expectedOption: z.string().min(1),
	expectedTopic: z.string().min(1),
});
type EvalCase = z.infer<typeof CaseSchema>;

const SetSchema = z.object({
	subject: z.string(),
	corpusVersion: z.number().int(),
	cases: z.array(CaseSchema),
});

const VISION_SET_PATH = resolve("evals/physics-10-vision.json");

// Same cases, plus the note explaining why they were held back.
const VisionSetSchema = SetSchema.extend({ note: z.string().optional() });

const deps = { llm: languageModel, embed: embedQuery, db: prisma };

// Questions that cannot be answered from text: each references a figure the dataset does not
// carry, so the model must fail and the failure is ours. Held back until image input
// arrives and they have to pass. This list is manual on purpose — three of the five never say
// «شکل», so no keyword scan finds them; only reading the stems does.
const VISION_ONLY = new Set([
	"6cc1b674", // asks for V' with no V-vs-m graph
	"8866f3f2", // "which cannot be inferred from the figure below"
	"8eac5bd9", // "which speedometer is more precise" — needs the images
	"9e140c69", // precision of instruments الف/ب/پ — needs the images
	"a7362c03", // "what is this instrument called" — needs the micrometer image
]);

// ── build ────────────────────────────────────────────────────────────────────
if (process.argv.includes("--build")) {
	const corpusVersion = await getActiveCorpusVersion(prisma);
	const rows = await prisma.exemplar.findMany({
		where: { corpusVersion },
		include: { topic: true, subject: true },
		orderBy: { id: "asc" },
	});

	const unresolved: string[] = [];
	const suspect: string[] = [];

	const cases: EvalCase[] = rows.flatMap((row) => {
		const raw = Array.isArray(row.options) ? (row.options as string[]) : [];
		const topic = canonicalTopic(row.topic.title);
		// Only multiple-choice items with a recorded answer can be scored on correctness.
		if (raw.length === 0 || !row.answer.trim() || !topic) return [];

		const options = raw.map(cleanOption);

		// Recover the option LABEL. The extraction stored it three different ways: the label
		// alone, the value with the label fused onto the end («۷/۷۵ ۱»), or the value with no
		// label at all («۱/۱»). All three are recovered by rule rather than per record.
		const answer = row.answer.trim();
		const fused = /^(.*\S)\s+([1-4۱-۴])$/.exec(answer);
		const byValue = () => {
			const i = options.findIndex(
				(o) => o && normalizePersian(o) === normalizePersian(answer),
			);
			return i >= 0 ? String(i + 1) : "";
		};

		let expectedOption = "";
		if (/^[1-4۱-۴]$/.test(answer)) {
			expectedOption = answer;
		} else if (fused?.[2]) {
			// Trust the fused label, but only when its option really carries that value.
			const label = normalizePersian(fused[2]);
			const value = normalizePersian(fused[1] ?? "");
			const atLabel = normalizePersian(options[Number(label) - 1] ?? "");
			expectedOption = atLabel === value ? label : byValue();
		} else {
			expectedOption = byValue();
		}
		if (!expectedOption) {
			unresolved.push(
				`${row.id.slice(0, 8)} answer=${JSON.stringify(row.answer)}`,
			);
			return [];
		}

		// Faithful transcriptions of defective slides exist — p52 really does print ۳۰/۶ twice.
		// Flag them so nobody later "fixes" the data by inventing distractors.
		const seen = new Set<string>();
		for (const o of options) {
			const key = normalizePersian(o);
			if (seen.has(key))
				suspect.push(`${row.id.slice(0, 8)} duplicate option ${o}`);
			seen.add(key);
		}

		return [
			{
				exemplarId: row.id,
				question: row.question,
				options,
				expectedOption: toPersianDigits(expectedOption),
				expectedTopic: topic,
			},
		];
	});

	const vision = cases.filter((c) => VISION_ONLY.has(c.exemplarId.slice(0, 8)));
	const text = cases.filter((c) => !VISION_ONLY.has(c.exemplarId.slice(0, 8)));
	const subjectTitle = rows[0]?.subject.title ?? "فیزیک دهم";

	await writeFile(
		SET_PATH,
		`${JSON.stringify({ subject: subjectTitle, corpusVersion, cases: text }, null, 2)}\n`,
	);
	await writeFile(
		VISION_SET_PATH,
		`${JSON.stringify(
			{
				subject: subjectTitle,
				corpusVersion,
				note: "Answerable only with the slide image.",
				cases: vision,
			},
			null,
			2,
		)}\n`,
	);

	console.log(`from ${rows.length} exemplar(s):`);
	console.log(`  ${text.length} text case(s)   -> ${SET_PATH}`);
	console.log(`  ${vision.length} vision case(s) -> ${VISION_SET_PATH}`);
	for (const s of suspect) console.log(`  source defect (left as-is): ${s}`);
	for (const u of unresolved)
		console.log(`  DROPPED, label unrecoverable: ${u}`);
	await prisma.$disconnect();
	process.exit(0);
}

const ORDINALS = ["اول", "دوم", "سوم", "چهارم"];

/** The option the model committed to: the last one it names, since it reasons before deciding. */
const statedOption = (text: string): string | null => {
	const normalized = normalizePersian(text);
	// Deliberately tolerant of what sits between the word and the number. The model most
	// often writes «گزینه‌ی درست: ۳», and a regex that demanded the digit immediately after
	// «گزینه» scored a run of correct answers as unparseable — which read as the corpus
	// failing rather than the harness.
	const named = [...normalized.matchAll(/گزینه[^0-9]{0,20}?([1-4])/g)].pop();
	if (named?.[1]) return named[1];
	// Persian names options as words at least as often as digits.
	const ordinal = ORDINALS.map((word, i) => ({
		at: Math.max(
			normalized.lastIndexOf(`گزینه‌ی ${word}`),
			normalized.lastIndexOf(`گزینه ${word}`),
		),
		option: String(i + 1),
	}))
		.filter((m) => m.at >= 0)
		.sort((a, b) => b.at - a.at)[0];
	return ordinal?.option ?? null;
};

// ── vision run ───────────────────────────────────────────────────────────────
// Five cases, each answerable only from the slide image. This is the gate for image input:
// nothing else counts as it working.
if (process.argv.includes("--vision")) {
	const set = VisionSetSchema.parse(
		JSON.parse(await readFile(VISION_SET_PATH, "utf8")),
	);
	const subject = await prisma.subject.findFirstOrThrow({
		where: { title: set.subject },
	});
	const corpusVersion = await getActiveCorpusVersion(prisma);

	// Each case's slide, found the way the review document finds it: the extraction cache is
	// keyed by page, so the exemplar's question text maps back to the page it came from.
	const cache: Record<string, { question?: string | null }> = JSON.parse(
		await readFile(EXTRACTION_PATH, "utf8"),
	);
	const pageOfQuestion = new Map<string, number>();
	for (const [page, slide] of Object.entries(cache)) {
		const q = slide.question?.trim();
		if (q && !pageOfQuestion.has(normalizePersian(q)))
			pageOfQuestion.set(normalizePersian(q), Number(page));
	}
	const rows = await prisma.exemplar.findMany({
		where: { corpusVersion },
		select: { id: true, question: true },
	});
	const pageOfExemplar = new Map<string, number>();
	for (const row of rows) {
		const page = pageOfQuestion.get(normalizePersian(row.question));
		if (page !== undefined) pageOfExemplar.set(row.id, page);
	}

	const doc = mupdf.Document.openDocument(
		await Bun.file(DECK_PATH).arrayBuffer(),
		"application/pdf",
	);
	// The slide is what the student would have photographed. Rendered at the size a phone
	// photo arrives at after client-side compression, so the eval and production see the
	// same thing.
	const renderSlide = (page: number) => {
		const pixmap = doc
			.loadPage(page)
			.toPixmap(
				mupdf.Matrix.scale(1.2, 1.2),
				mupdf.ColorSpace.DeviceRGB,
				false,
				true,
			);
		const data = pixmap.asPNG();
		pixmap.destroy();
		return { data: new Uint8Array(data), mediaType: "image/png" };
	};

	const loadImage = async (imageUrl: string) => {
		const page = Number(imageUrl.replace("slide:", ""));
		return Number.isFinite(page) ? renderSlide(page) : null;
	};

	// Does the answer actually talk about the picture? A keyword scan, not a judge: crude,
	// but transparent and cheap, and it is a floor rather than a claim — an answer that
	// never says «شکل» or «نمودار» certainly did not reason from one.
	const FIGURE_WORDS = [
		"شکل",
		"نمودار",
		"تصویر",
		"عقربه",
		"درجه",
		"محور",
		"صفحه",
		"رسم",
		"خط‌کش",
		"مدرج",
	];
	const mentionsFigure = (text: string) => {
		const normalized = normalizePersian(text);
		return FIGURE_WORDS.filter((w) => normalized.includes(normalizePersian(w)));
	};

	const runVision = async (test: EvalCase, withImage: boolean) => {
		const page = pageOfExemplar.get(test.exemplarId);
		let text = "";
		let mode: AnswerMode | null = null;
		for await (const chunk of answer(
			{
				question: asAsked(test),
				subjectId: subject.id,
				history: [],
				...(withImage && page !== undefined
					? { imageUrl: `slide:${page}` }
					: {}),
			},
			{ ...deps, ...(withImage ? { loadImage } : {}) },
			{ excludeExemplarIds: [test.exemplarId] },
		)) {
			if (chunk.type === "text") text += chunk.delta;
			else if (chunk.type === "mode") mode = chunk.mode;
		}
		return { text, mode, page };
	};

	console.log(
		`running ${set.cases.length} vision case(s) against corpusVersion ${corpusVersion}...`,
	);
	const results = [];
	for (const test of set.cases) {
		const withImage = await runVision(test, true);
		// The control: four of these five once passed on text alone, so a correct answer with
		// the image proves nothing on its own.
		const withoutImage = await runVision(test, false);
		const expected = normalizePersian(test.expectedOption);
		results.push({
			id: test.exemplarId.slice(0, 8),
			page: withImage.page === undefined ? null : withImage.page + 1,
			expected,
			got: statedOption(withImage.text),
			gotBlind: statedOption(withoutImage.text),
			figureWords: mentionsFigure(withImage.text),
			mode: withImage.mode,
		});
		process.stdout.write(`  ${results.length}/${set.cases.length}\r`);
	}
	console.log();

	const correct = results.filter((r) => r.got === r.expected);
	const blindCorrect = results.filter((r) => r.gotBlind === r.expected);
	const grounded = results.filter((r) => r.figureWords.length > 0);

	console.log("\n--- eval: physics-10 VISION ---");
	console.log(`cases                 ${results.length}`);
	console.log(
		`correct with image    ${correct.length}/${results.length}  ${((100 * correct.length) / results.length).toFixed(0)}%`,
	);
	console.log(
		`correct WITHOUT image ${blindCorrect.length}/${results.length}  (control — these cannot be credited to vision)`,
	);
	console.log(
		`reasoning names the figure  ${grounded.length}/${results.length}`,
	);
	console.log("\nper case:");
	console.log(
		`${"id".padEnd(10)}${"slide".padEnd(7)}${"exp".padEnd(5)}${"got".padEnd(5)}${"blind".padEnd(7)}figure words`,
	);
	for (const r of results) {
		console.log(
			`${r.id.padEnd(10)}${String(r.page ?? "—").padEnd(7)}${r.expected.padEnd(5)}${(r.got ?? "—").padEnd(5)}${(r.gotBlind ?? "—").padEnd(7)}${r.figureWords.join(" ") || "none"}`,
		);
	}

	await prisma.$disconnect();
	process.exit(correct.length === results.length ? 0 : 1);
}

// ── run ──────────────────────────────────────────────────────────────────────
const set = SetSchema.parse(
	JSON.parse(
		await readFile(SET_PATH, "utf8").catch(() => {
			console.error(`Missing ${SET_PATH}. Run \`bun run eval --build\` first.`);
			process.exit(1);
		}),
	),
);

const subject = await prisma.subject.findFirstOrThrow({
	where: { title: set.subject },
});

// Ablation: exclude every exemplar, so retrieval returns nothing and the model answers from
// its own physics. If the score does not drop, the corpus is not earning its place; if it
// rises, retrieval is actively harming. Uses the existing holdout mechanism, so the
// production path needs no eval-only branch.
const ablate = process.argv.includes("--ablate");
const allExemplarIds = ablate
	? (await prisma.exemplar.findMany({ select: { id: true } })).map((e) => e.id)
	: [];

type Outcome = {
	exemplarId: string;
	optionOk: boolean;
	modeOk: boolean;
	topicOk: boolean;
	expected: string;
	got: string | null;
	mode: AnswerMode | null;
	topics: string[];
};

const runCase = async (test: EvalCase): Promise<Outcome> => {
	let mode: AnswerMode | null = null;
	let text = "";
	let sources: SourceRef[] = [];

	for await (const chunk of answer(
		{ question: asAsked(test), subjectId: subject.id, history: [] },
		deps,
		{ excludeExemplarIds: ablate ? allExemplarIds : [test.exemplarId] },
	)) {
		if (chunk.type === "mode") mode = chunk.mode;
		else if (chunk.type === "text") text += chunk.delta;
		else if (chunk.type === "sources") sources = chunk.sources;
	}

	const topics = [
		...new Set(
			sources.flatMap((s) =>
				s.kind === "method-card" ? [s.label] : (canonicalTopic(s.label) ?? []),
			),
		),
	];
	const got = statedOption(text);
	return {
		exemplarId: test.exemplarId,
		// normalizePersian folds both digit forms to ASCII, so «۳» and "3" compare equal —
		// the dataset carries both and the mismatch is the same class of bug as the parser.
		optionOk: got !== null && got === normalizePersian(test.expectedOption),
		modeOk: mode === "teacher",
		topicOk: topics.includes(test.expectedTopic),
		expected: normalizePersian(test.expectedOption),
		got,
		mode,
		topics,
	};
};

console.log(
	`running ${set.cases.length} case(s) against corpusVersion ${set.corpusVersion} (concurrency ${CONCURRENCY})...`,
);
const outcomes: Outcome[] = [];
for (let i = 0; i < set.cases.length; i += CONCURRENCY) {
	const batch = await Promise.all(
		set.cases.slice(i, i + CONCURRENCY).map(runCase),
	);
	outcomes.push(...batch);
	process.stdout.write(`  ${outcomes.length}/${set.cases.length}\r`);
}
console.log();

const pct = (n: number) => `${((100 * n) / outcomes.length).toFixed(1)}%`;
const option = outcomes.filter((o) => o.optionOk).length;
const modeScore = outcomes.filter((o) => o.modeOk).length;
const topic = outcomes.filter((o) => o.topicOk).length;

// Localising the failure is the point of scoring three things: an answer that is wrong with
// the right topic retrieved is a generation problem, and one with the wrong topic is a
// retrieval problem. They need different fixes.
const retrievalFailures = outcomes.filter(
	(o) => !o.optionOk && !o.topicOk,
).length;
const generationFailures = outcomes.filter(
	(o) => !o.optionOk && o.topicOk,
).length;

console.log("\n--- eval: physics-10 ---");
console.log(`cases                ${outcomes.length}`);
console.log(
	`correct option       ${option}/${outcomes.length}  ${pct(option)}`,
);
console.log(
	`mode = teacher       ${modeScore}/${outcomes.length}  ${pct(modeScore)}`,
);
console.log(`right topic retrieved ${topic}/${outcomes.length}  ${pct(topic)}`);
console.log(`\nof the ${outcomes.length - option} wrong answers:`);
console.log(`  retrieval failed (wrong topic)   ${retrievalFailures}`);
console.log(`  generation failed (right topic)  ${generationFailures}`);

const wrong = outcomes.filter((o) => !o.optionOk).slice(0, 10);
if (wrong.length) {
	console.log("\nfirst wrong answers:");
	for (const o of wrong) {
		console.log(
			`  expected ${o.expected} got ${o.got ?? "none"} | mode=${o.mode} | topics=${o.topics.join(", ") || "none"}`,
		);
	}
}

await prisma.$disconnect();
