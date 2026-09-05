// The ink oracle. A pixel measure with no model in it, which is the whole point: it is the
// independent check on what the VLM claims to have read off a slide. If the model reports
// the teacher's handwriting on a page this says is clean, the model invented it.
//
// The deck is white-and-blue printed material on black. The teacher writes in saturated
// green, cyan and yellow. So teacher ink is: green channel strong, colour far from grey
// (which rules out white printed text), and green not dominated by blue (which rules out
// the printed blue option pills and blue section banners).

export type Pixels = {
	samples: Uint8ClampedArray | Uint8Array;
	width: number;
	height: number;
	components: number;
};

// Saturation, not raw channel spread. An absolute spread test looks right and is not:
// white printed text anti-aliased against a black slide produces muted intermediates like
// (240,240,180) and the printed teal rules produce (120,180,180), both of which clear any
// reasonable absolute threshold. Measured against pages with known ground truth, a clean
// lesson slide scored higher than a slide with real handwriting on it until this became a
// ratio. Teacher ink is genuinely saturated; anti-aliasing never is.
const MIN_GREEN = 110;
const MIN_SATURATION = 0.4;

export function isTeacherInk(r: number, g: number, b: number): boolean {
	if (g <= MIN_GREEN) return false; // background, blue option pills, the red logo
	const max = Math.max(r, g, b);
	const saturation = (max - Math.min(r, g, b)) / max;
	if (saturation < MIN_SATURATION) return false; // white text, greys, printed teal
	if (g + 40 < b) return false; // printed blue (b well above g) is not the teacher
	return g + 30 >= r; // warm anti-alias edges (r above g) are not the teacher either
}

/** Fraction of sampled pixels that carry teacher ink. Sampling is deterministic. */
export function inkScore(
	{ samples, width, height, components }: Pixels,
	step = 2,
): number {
	let hits = 0;
	let total = 0;
	for (let y = 0; y < height; y += step) {
		for (let x = 0; x < width; x += step) {
			const i = (y * width + x) * components;
			total++;
			if (
				isTeacherInk(samples[i] ?? 0, samples[i + 1] ?? 0, samples[i + 2] ?? 0)
			)
				hits++;
		}
	}
	return total === 0 ? 0 : hits / total;
}

/** Per-pixel teacher-ink mask, for comparing two snapshots of the same slide. */
export function inkMask({
	samples,
	width,
	height,
	components,
}: Pixels): Uint8Array {
	const mask = new Uint8Array(width * height);
	for (let p = 0, i = 0; p < mask.length; p++, i += components) {
		mask[p] = isTeacherInk(
			samples[i] ?? 0,
			samples[i + 1] ?? 0,
			samples[i + 2] ?? 0,
		)
			? 1
			: 0;
	}
	return mask;
}

/**
 * Ink present in `page` and absent from `baseline` — the same slide photographed later in
 * the term. Colour alone cannot do this job: the printed artwork uses the teacher's own
 * palette (one lesson slide carries a printed yellow ruler), so an absolute measure scores
 * a clean slide as heavily written on. Differencing two snapshots cancels everything
 * printed and leaves only what the teacher added.
 *
 * The limitation this carries: ink already present in BOTH snapshots is invisible to it.
 */
export function inkDelta(page: Uint8Array, baseline: Uint8Array): number {
	if (page.length !== baseline.length) return Number.NaN;
	let added = 0;
	for (let p = 0; p < page.length; p++) if (page[p] && !baseline[p]) added++;
	return page.length === 0 ? 0 : added / page.length;
}

// Calibrated on the real deck against pages with visual ground truth, as inkDelta:
//   Fasle 1 p40  0.0002  verified clean — the printed yellow ruler cancels
//   merged  p0   0.0052  thin yellow handwriting on a busy title slide
//   Fasle 1 p60  0.0063  one filled-in blank
//   Andazegiri p45 0.0161 full worked solution
//   Fasle 1 p95  0.0203  full worked solution plus margin note
// Named constants, not literals at the call sites, so the script that builds the deck and
// the script that checks the model cannot drift apart.
export const INK_PRESENT = 0.002;

// Above this a page carries a real worked solution rather than a stray tick, so an
// extraction that comes back nearly empty is a failure rather than a quiet slide.
export const INK_HEAVY = 0.01;
