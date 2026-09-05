// Trace the teacher's ink off one slide into SVG centrelines, for the login board.
//
//   bun run trace:ink                 slide 71, the worked density solution
//   bun run trace:ink --page 47       any other page
//
// Why centrelines and not an outline trace: potrace-style tracing gives the *contour* of
// each stroke, so animating stroke-dasharray draws a loop around the pen mark rather than
// the mark itself. Thinning the ink to one-pixel skeletons and walking those gives paths
// that a round-capped stroke redraws exactly the way he wrote them.
//
// Output is a committed TS module. Nothing traces at runtime, and the login page ships a
// few kilobytes of path data rather than an image.

import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import * as mupdf from "mupdf";
import { isTeacherInk } from "@/lib/knowledge/ink";

const PDF = resolve("content/derived/chapter-1.pdf");
const OUT = resolve("components/auth/handwriting.ts");
const SCALE = 1.5;

const arg = (name: string, fallback: number) => {
	const i = process.argv.indexOf(`--${name}`);
	return i >= 0 ? Number(process.argv[i + 1]) : fallback;
};
const page = arg("page", 71);

// The printed lesson text sits in a band across the middle and clips the ink mask enough to
// register. Keeping only the lower half takes the worked solution and leaves that out.
const CROP_TOP = arg("crop-top", 0.5);

// ── ink mask ─────────────────────────────────────────────────────────────────
const doc = mupdf.Document.openDocument(
	await Bun.file(PDF).arrayBuffer(),
	"application/pdf",
);
const pixmap = doc
	.loadPage(page - 1)
	.toPixmap(
		mupdf.Matrix.scale(SCALE, SCALE),
		mupdf.ColorSpace.DeviceRGB,
		false,
		true,
	);

const fullWidth = pixmap.getWidth();
const fullHeight = pixmap.getHeight();
const components = pixmap.getNumberOfComponents();
const samples = pixmap.getPixels();

const y0 = Math.floor(fullHeight * CROP_TOP);
const width = fullWidth;
const height = fullHeight - y0;

const mask = new Uint8Array(width * height);
for (let y = 0; y < height; y++) {
	for (let x = 0; x < width; x++) {
		const p = ((y + y0) * fullWidth + x) * components;
		if (
			isTeacherInk(
				samples[p] as number,
				samples[p + 1] as number,
				samples[p + 2] as number,
			)
		)
			mask[y * width + x] = 1;
	}
}

// ── despeckle ────────────────────────────────────────────────────────────────
// Anti-aliased edges leave single lit pixels that thin into one-point "strokes".
const neighbours = (m: Uint8Array, x: number, y: number) => {
	let n = 0;
	for (let dy = -1; dy <= 1; dy++)
		for (let dx = -1; dx <= 1; dx++) {
			if (dx === 0 && dy === 0) continue;
			const nx = x + dx;
			const ny = y + dy;
			if (nx >= 0 && nx < width && ny >= 0 && ny < height && m[ny * width + nx])
				n++;
		}
	return n;
};
for (let y = 0; y < height; y++)
	for (let x = 0; x < width; x++)
		if (mask[y * width + x] && neighbours(mask, x, y) === 0)
			mask[y * width + x] = 0;

// ── Zhang–Suen thinning ──────────────────────────────────────────────────────
// The standard two-subiteration algorithm: erode boundary pixels whose removal cannot break
// a stroke, until nothing changes. What survives is a one-pixel-wide skeleton.
/** Erodes `m` in place until only one-pixel-wide skeletons remain. */
function thin(m: Uint8Array): void {
	const at = (x: number, y: number) =>
		x < 0 || y < 0 || x >= width || y >= height
			? 0
			: (m[y * width + x] as number);

	let changed = true;
	while (changed) {
		changed = false;
		for (const step of [0, 1]) {
			const doomed: number[] = [];
			for (let y = 1; y < height - 1; y++) {
				for (let x = 1; x < width - 1; x++) {
					if (!m[y * width + x]) continue;
					// P2..P9 clockwise from north
					const p = [
						at(x, y - 1),
						at(x + 1, y - 1),
						at(x + 1, y),
						at(x + 1, y + 1),
						at(x, y + 1),
						at(x - 1, y + 1),
						at(x - 1, y),
						at(x - 1, y - 1),
					];
					const filled = p.reduce((a, b) => a + b, 0);
					if (filled < 2 || filled > 6) continue;
					let transitions = 0;
					for (let i = 0; i < 8; i++)
						if (!p[i] && p[(i + 1) % 8]) transitions++;
					if (transitions !== 1) continue;
					const [n, ne, e, se, s, sw, w, nw] = p as number[];
					if (step === 0) {
						if (n && e && s) continue;
						if (e && s && w) continue;
					} else {
						if (n && e && w) continue;
						if (n && s && w) continue;
					}
					void ne;
					void se;
					void sw;
					void nw;
					doomed.push(y * width + x);
				}
			}
			for (const i of doomed) m[i] = 0;
			if (doomed.length) changed = true;
		}
	}
}
thin(mask);

// ── walk the skeleton into polylines ─────────────────────────────────────────
type Point = [number, number];

const NEIGHBOURS: Point[] = [
	[1, 0],
	[1, 1],
	[0, 1],
	[-1, 1],
	[-1, 0],
	[-1, -1],
	[0, -1],
	[1, -1],
];

const live = (x: number, y: number) =>
	x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] === 1;

const degreeOf = (x: number, y: number) =>
	NEIGHBOURS.filter(([dx, dy]) => live(x + dx, y + dy)).length;

/** Walks from a seed until the stroke ends or forks, consuming pixels as it goes. */
function walk(sx: number, sy: number): Point[] {
	const points: Point[] = [[sx, sy]];
	mask[sy * width + sx] = 0;
	let [x, y] = [sx, sy];
	for (;;) {
		const next = NEIGHBOURS.map(([dx, dy]) => [x + dx, y + dy] as Point).find(
			([nx, ny]) => live(nx, ny),
		);
		if (!next) return points;
		[x, y] = next;
		mask[y * width + x] = 0;
		points.push([x, y]);
	}
}

const strokes: Point[][] = [];
// Endpoints first, so strokes are walked from a natural start rather than mid-line; whatever
// is left over is a closed loop (an O, a circled digit) and can start anywhere.
for (const onlyEndpoints of [true, false]) {
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			if (mask[y * width + x] !== 1) continue;
			if (onlyEndpoints && degreeOf(x, y) !== 1) continue;
			const stroke = walk(x, y);
			if (stroke.length > 6) strokes.push(stroke);
		}
	}
}

// ── simplify ─────────────────────────────────────────────────────────────────
// Ramer–Douglas–Peucker. A skeleton is one point per pixel; at 0.8px tolerance the shape is
// visually identical and the file is an order of magnitude smaller.
function simplify(points: Point[], tolerance: number): Point[] {
	if (points.length < 3) return points;
	const [ax, ay] = points[0] as Point;
	const [bx, by] = points[points.length - 1] as Point;
	let worst = 0;
	let index = 0;
	const dx = bx - ax;
	const dy = by - ay;
	const len = Math.hypot(dx, dy) || 1;
	for (let i = 1; i < points.length - 1; i++) {
		const [px, py] = points[i] as Point;
		const d = Math.abs(dy * px - dx * py + bx * ay - by * ax) / len;
		if (d > worst) {
			worst = d;
			index = i;
		}
	}
	if (worst <= tolerance)
		return [points[0] as Point, points[points.length - 1] as Point];
	return [
		...simplify(points.slice(0, index + 1), tolerance),
		...simplify(points.slice(index), tolerance).slice(1),
	];
}

// ── order for playback ───────────────────────────────────────────────────────
// Banded top-to-bottom, then right-to-left inside a band: the order he wrote it, because
// the page is Persian.
const BAND = 40;
const ordered = strokes
	.map((s) => simplify(s, 0.8))
	.filter((s) => s.length >= 2)
	.map((s) => {
		const xs = s.map(([x]) => x);
		const ys = s.map(([, y]) => y);
		return { points: s, top: Math.min(...ys), right: Math.max(...xs) };
	})
	.sort(
		(a, b) =>
			Math.floor(a.top / BAND) - Math.floor(b.top / BAND) || b.right - a.right,
	);

// Trim the viewBox to the ink, so the board has no dead margin.
const allX = ordered.flatMap((s) => s.points.map(([x]) => x));
const allY = ordered.flatMap((s) => s.points.map(([, y]) => y));
const pad = 12;
const minX = Math.min(...allX) - pad;
const minY = Math.min(...allY) - pad;
const boxW = Math.max(...allX) - minX + pad;
const boxH = Math.max(...allY) - minY + pad;

const toPath = (points: Point[]) =>
	points
		.map(
			([x, y], i) =>
				`${i ? "L" : "M"}${(x - minX).toFixed(1)} ${(y - minY).toFixed(1)}`,
		)
		.join("");

const paths = ordered.map((s) => toPath(s.points));
const lengths = ordered.map((s) =>
	Math.round(
		s.points.reduce(
			(total, p, i) =>
				i === 0
					? 0
					: total +
						Math.hypot(
							p[0] - (s.points[i - 1] as Point)[0],
							p[1] - (s.points[i - 1] as Point)[1],
						),
			0,
		),
	),
);

await writeFile(
	OUT,
	`// GENERATED by \`bun run trace:ink\` from content/derived/chapter-1.pdf, slide ${page}.
// The teacher's own ink, thinned to centrelines and walked into paths. Do not hand-edit.
export const HANDWRITING = {
	slide: ${page},
	viewBox: "0 0 ${boxW.toFixed(0)} ${boxH.toFixed(0)}",
	/** Stroke length in user units, so each path can be dashed to its own size. */
	lengths: ${JSON.stringify(lengths)},
	paths: ${JSON.stringify(paths, null, 1).replace(/\n/g, "\n\t")},
} as const;
`,
);

const points = ordered.reduce((n, s) => n + s.points.length, 0);
console.log(`slide ${page}: ${paths.length} strokes, ${points} points`);
console.log(`viewBox 0 0 ${boxW.toFixed(0)} ${boxH.toFixed(0)}`);
console.log(`total ink length ${lengths.reduce((a, b) => a + b, 0)} units`);
console.log(`written to ${OUT}`);
