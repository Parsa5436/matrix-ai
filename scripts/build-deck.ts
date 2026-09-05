// Build the single chapter-1 deck from the two files that are really one deck photographed
// at different points in the term, then score every page with the ink oracle.
//
//   bun run deck:build
//
// Andazegiri (E3) and Fasle 1 Kamel (E5) share pages 0..57 one-to-one with no offset; they
// differ only in how much the teacher had written by the time each was saved. For every
// shared page we keep whichever copy carries more ink — page by page, never at a fixed
// midpoint, because pages 55 and 56 go the other way. Pages 58..100 exist only in Fasle 1.
//
// Both files must never reach the ingest. Fifty-eight duplicated slides would fill the
// exemplar bank with near-identical questions and quietly poison retrieval.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import * as mupdf from "mupdf";
import { inkDelta, inkMask, inkScore } from "@/lib/knowledge/ink";

const OUT_DIR = resolve("content/derived");
const DECK_PATH = join(OUT_DIR, "chapter-1.pdf");
const MANIFEST_PATH = join(OUT_DIR, "chapter-1.manifest.json");

const SHARED_PAGES = 58; // 0..57 appear in both files
const SCORE_SCALE = 0.5; // 36 dpi is plenty to compare two snapshots for total ink
const ORACLE_SCALE = 0.75; // the differential needs a little more detail to be stable

const arg = (name: string, fallback: string) => {
	const i = process.argv.indexOf(`--${name}`);
	return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
};

const sources = {
	andazegiri: resolve(
		arg("andazegiri", "content/derived/sources/andazegiri-e3.pdf"),
	),
	fasle1: resolve(arg("fasle1", "content/derived/sources/fasle1-kamel-e5.pdf")),
	// The same deck earlier in the term. Used only as the baseline for the differential ink
	// oracle on pages 58..100, which the other two files do not share.
	fasle1Baseline: resolve(
		arg("fasle1-baseline", "content/derived/sources/fasle1-kamel-e3.pdf"),
	),
};

const open = async (path: string) => {
	const bytes = await readFile(path).catch(() => null);
	if (!bytes) {
		console.error(
			`Missing ${path}.\nExtract the two source PDFs first — see content/derived/README.txt`,
		);
		process.exit(1);
	}
	return mupdf.Document.openDocument(
		bytes,
		"application/pdf",
	) as mupdf.PDFDocument;
};

const pixelsOf = (doc: mupdf.PDFDocument, index: number, scale: number) => {
	const pixmap = doc
		.loadPage(index)
		.toPixmap(
			mupdf.Matrix.scale(scale, scale),
			mupdf.ColorSpace.DeviceRGB,
			false,
		);
	const pixels = {
		samples: pixmap.getPixels(),
		width: pixmap.getWidth(),
		height: pixmap.getHeight(),
		components: pixmap.getNumberOfComponents(),
	};
	pixmap.destroy();
	return pixels;
};

/** Total colour-matching ink. Only used to decide which of two snapshots has more. */
const scorePage = (doc: mupdf.PDFDocument, index: number) =>
	inkScore(pixelsOf(doc, index, SCORE_SCALE));

/** The oracle proper: ink this snapshot has that the earlier one does not. */
const deltaPage = (
	doc: mupdf.PDFDocument,
	baseline: mupdf.PDFDocument,
	index: number,
) =>
	inkDelta(
		inkMask(pixelsOf(doc, index, ORACLE_SCALE)),
		inkMask(pixelsOf(baseline, index, ORACLE_SCALE)),
	);

const andazegiri = await open(sources.andazegiri);
const fasle1 = await open(sources.fasle1);
const fasle1Baseline = await open(sources.fasle1Baseline);

console.log(
	`andazegiri: ${andazegiri.countPages()} pages | fasle1: ${fasle1.countPages()} pages`,
);
if (fasle1.countPages() < SHARED_PAGES) {
	console.error("fasle1 is shorter than the shared range — wrong file?");
	process.exit(1);
}

type PageChoice = {
	page: number;
	source: "andazegiri" | "fasle1";
	/** total colour-matching ink in each snapshot — only used to pick the fuller page */
	inkAndazegiri: number | null;
	inkFasle1: number;
	/** the oracle: ink the chosen snapshot has and its baseline does not */
	ink: number;
	oracleBaseline: "andazegiri" | "fasle1" | "fasle1-e3";
};

console.log("scoring both files page by page...");
const choices: PageChoice[] = [];
for (let page = 0; page < fasle1.countPages(); page++) {
	const inkFasle1 = scorePage(fasle1, page);
	const shared = page < SHARED_PAGES && page < andazegiri.countPages();
	const inkAndazegiri = shared ? scorePage(andazegiri, page) : null;
	const source =
		inkAndazegiri !== null && inkAndazegiri > inkFasle1
			? "andazegiri"
			: "fasle1";

	// For a shared page the other file IS the earlier snapshot. For the tail only Fasle 1
	// exists, so its own earlier export is the baseline.
	const [chosen, baseline, oracleBaseline] = shared
		? source === "andazegiri"
			? ([andazegiri, fasle1, "fasle1"] as const)
			: ([fasle1, andazegiri, "andazegiri"] as const)
		: ([fasle1, fasle1Baseline, "fasle1-e3"] as const);

	choices.push({
		page,
		source,
		inkAndazegiri,
		inkFasle1,
		ink: deltaPage(chosen, baseline, page),
		oracleBaseline,
	});
}

const merged = new mupdf.PDFDocument();
for (const choice of choices) {
	const from = choice.source === "andazegiri" ? andazegiri : fasle1;
	merged.graftPage(-1, from, choice.page);
}

await mkdir(dirname(DECK_PATH), { recursive: true });
await writeFile(DECK_PATH, merged.saveToBuffer("compress").asUint8Array());

// grafted pages are the source pages, so the delta measured above still describes them
const deck = mupdf.Document.openDocument(
	await readFile(DECK_PATH),
	"application/pdf",
) as mupdf.PDFDocument;

const pages = choices.map((choice) => ({
	...choice,
	ink: Number(choice.ink.toFixed(6)),
	inkAndazegiri:
		choice.inkAndazegiri === null
			? null
			: Number(choice.inkAndazegiri.toFixed(6)),
	inkFasle1: Number(choice.inkFasle1.toFixed(6)),
}));

await writeFile(
	MANIFEST_PATH,
	`${JSON.stringify(
		{
			builtFrom: sources,
			sharedPages: SHARED_PAGES,
			scoreScale: SCORE_SCALE,
			pageCount: deck.countPages(),
			pages,
		},
		null,
		2,
	)}\n`,
);

const fromAndazegiri = pages.filter((p) => p.source === "andazegiri").length;
const flipped = pages.filter(
	(p) =>
		p.inkAndazegiri !== null &&
		p.inkFasle1 > p.inkAndazegiri &&
		p.inkFasle1 > 0,
);

console.log(`\n--- deck built ---`);
console.log(`pages                ${deck.countPages()}`);
console.log(`from andazegiri      ${fromAndazegiri}`);
console.log(`from fasle1          ${pages.length - fromAndazegiri}`);
console.log(
	`shared pages where fasle1 won: ${flipped.map((p) => p.page).join(", ") || "none"}`,
);
console.log(`deck                 ${DECK_PATH}`);
console.log(`manifest             ${MANIFEST_PATH}`);
