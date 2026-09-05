import { describe, expect, test } from "bun:test";
import { inkDelta, inkMask, inkScore, isTeacherInk, type Pixels } from "./ink";

// The colours actually present in the deck, sampled from the rendered slides.
const BACKGROUND = [0, 0, 0] as const;
const PRINTED_WHITE = [255, 255, 255] as const;
const PRINTED_BLUE_PILL = [26, 115, 232] as const;
const PRINTED_RED_LOGO = [200, 30, 30] as const;
const TEACHER_GREEN = [40, 230, 60] as const;
const TEACHER_CYAN = [40, 235, 235] as const;
const TEACHER_YELLOW = [240, 235, 40] as const;

describe("isTeacherInk", () => {
	test("accepts the three colours the teacher writes in", () => {
		expect(isTeacherInk(...TEACHER_GREEN)).toBe(true);
		expect(isTeacherInk(...TEACHER_CYAN)).toBe(true);
		expect(isTeacherInk(...TEACHER_YELLOW)).toBe(true);
	});

	// Each of these is a false positive that would make the oracle useless: it would call
	// every page annotated and stop catching hallucinated handwriting.
	test("rejects the printed material and the background", () => {
		expect(isTeacherInk(...BACKGROUND)).toBe(false);
		expect(isTeacherInk(...PRINTED_WHITE)).toBe(false);
		expect(isTeacherInk(...PRINTED_BLUE_PILL)).toBe(false);
		expect(isTeacherInk(...PRINTED_RED_LOGO)).toBe(false);
	});

	test("rejects greys and near-whites regardless of brightness", () => {
		for (const v of [120, 160, 200, 240])
			expect(isTeacherInk(v, v, v)).toBe(false);
	});

	// The bug this guards, caught by calibrating against a slide known to be clean: white
	// printed text anti-aliased on a black background lands on muted intermediates, and the
	// printed teal rules on another. Under an absolute channel-spread test both counted as
	// ink, and a verified-clean lesson slide scored HIGHER than a slide with real
	// handwriting on it — which would have made the oracle worse than useless, because it
	// would have reported hallucinations everywhere and caught none.
	test("rejects anti-aliasing artefacts and printed teal", () => {
		expect(isTeacherInk(240, 240, 180)).toBe(false); // white text edge
		expect(isTeacherInk(120, 180, 180)).toBe(false); // printed teal rule
		expect(isTeacherInk(180, 180, 120)).toBe(false); // warm white edge
	});
});

const page = (fill: readonly number[], inkPixels: number): Pixels => {
	const width = 100;
	const height = 100;
	const samples = new Uint8ClampedArray(width * height * 3);
	for (let i = 0; i < samples.length; i += 3) {
		samples[i] = fill[0] ?? 0;
		samples[i + 1] = fill[1] ?? 0;
		samples[i + 2] = fill[2] ?? 0;
	}
	// step=2 samples every other pixel on both axes, so paint a contiguous run that the
	// sampler is guaranteed to hit.
	for (let n = 0; n < inkPixels; n++) {
		const i = n * 2 * 3;
		samples[i] = TEACHER_GREEN[0];
		samples[i + 1] = TEACHER_GREEN[1];
		samples[i + 2] = TEACHER_GREEN[2];
	}
	return { samples, width, height, components: 3 };
};

describe("inkScore", () => {
	test("a clean printed page scores zero", () => {
		expect(inkScore(page(PRINTED_WHITE, 0))).toBe(0);
		expect(inkScore(page(BACKGROUND, 0))).toBe(0);
	});

	test("score rises with the amount of ink", () => {
		const light = inkScore(page(BACKGROUND, 50));
		const heavy = inkScore(page(BACKGROUND, 500));
		expect(light).toBeGreaterThan(0);
		expect(heavy).toBeGreaterThan(light);
	});

	test("ignores an alpha channel when the pixmap has one", () => {
		const rgb = page(BACKGROUND, 100);
		const rgba: Pixels = {
			width: rgb.width,
			height: rgb.height,
			components: 4,
			samples: new Uint8ClampedArray(rgb.width * rgb.height * 4),
		};
		for (let p = 0; p < rgb.width * rgb.height; p++) {
			rgba.samples[p * 4] = rgb.samples[p * 3] ?? 0;
			rgba.samples[p * 4 + 1] = rgb.samples[p * 3 + 1] ?? 0;
			rgba.samples[p * 4 + 2] = rgb.samples[p * 3 + 2] ?? 0;
			rgba.samples[p * 4 + 3] = 255;
		}
		expect(inkScore(rgba)).toBeGreaterThan(0);
	});
});

describe("inkDelta", () => {
	const maskOf = (fill: readonly number[], inkPixels: number) =>
		inkMask(page(fill, inkPixels));

	// The failure this exists for: a printed yellow ruler on a lesson slide is the same
	// colour as the teacher's pen, so an absolute measure calls a clean slide annotated.
	// Differenced against the same slide from another week, printed artwork cancels.
	test("printed artwork present in both snapshots cancels", () => {
		const artwork = maskOf(TEACHER_YELLOW, 0); // whole page is 'ink'-coloured artwork
		expect(inkDelta(artwork, artwork)).toBe(0);
	});

	test("ink added since the baseline survives", () => {
		const before = maskOf(BACKGROUND, 0);
		const after = maskOf(BACKGROUND, 400);
		expect(inkDelta(after, before)).toBeGreaterThan(0);
	});

	test("is directional — removing ink is not adding it", () => {
		const before = maskOf(BACKGROUND, 0);
		const after = maskOf(BACKGROUND, 400);
		expect(inkDelta(before, after)).toBe(0);
	});

	test("mismatched page sizes are NaN rather than a silently wrong number", () => {
		expect(inkDelta(new Uint8Array(4), new Uint8Array(9))).toBeNaN();
	});
});
