import { HANDWRITING } from "./handwriting";

// The teacher's own working from slide 71, redrawn stroke by stroke. This is the one thing
// on the page a competitor cannot copy, so it is worth the panel.
//
// No JavaScript: every stroke shares one animation whose duration is the whole cycle, and
// a staggered delay puts each at its own offset. The writing sweeps on in the order he
// wrote it, holds, then lifts off in the same order, forever. Per-stroke keyframes would
// mean 249 rules; this is one.

const DRAW_SECONDS = 11; // how long the whole solution takes to appear
const CYCLE_SECONDS = 19; // draw, hold, lift, pause

const totalLength = HANDWRITING.lengths.reduce((a, b) => a + b, 0);

export function HandwritingBoard() {
	let drawn = 0;

	return (
		<div className="relative isolate hidden overflow-hidden bg-[oklch(0.16_0.02_262)] lg:block">
			{/* Vignette, so the board does not read as a flat rectangle. */}
			<div
				aria-hidden="true"
				className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_35%,oklch(0.1_0.02_262)_100%)]"
			/>

			<div className="flex h-full items-center justify-center p-10">
				<svg
					aria-label="دست‌خط استاد: حل یک مسئله‌ی چگالی آلیاژ، مرحله به مرحله"
					className="w-full"
					role="img"
					viewBox={HANDWRITING.viewBox}
				>
					<title>دست‌خط استاد</title>
					{HANDWRITING.paths.map((d, i) => {
						const length = HANDWRITING.lengths[i] ?? 0;
						const delay = (drawn / totalLength) * DRAW_SECONDS;
						drawn += length;
						return (
							<path
								className="ink"
								d={d}
								fill="none"
								// biome-ignore lint/suspicious/noArrayIndexKey: a generated, fixed list that never reorders
								key={i}
								stroke="currentColor"
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={1.6}
								// Width in device pixels, not viewBox units: the box is 1355 units wide
								// and paints into ~500px, where a unit-scaled stroke is sub-pixel.
								vectorEffect="non-scaling-stroke"
								style={{
									// Both read by the keyframes below.
									["--len" as string]: length,
									["--delay" as string]: `${delay.toFixed(2)}s`,
								}}
							/>
						);
					})}
				</svg>
			</div>

			<style>{`
				.ink {
					color: oklch(0.86 0.16 155);
					stroke-dasharray: var(--len);
					stroke-dashoffset: var(--len);
					animation: ink-draw ${CYCLE_SECONDS}s linear var(--delay) infinite;
				}
				@keyframes ink-draw {
					0%        { stroke-dashoffset: var(--len); }
					6%, 68%   { stroke-dashoffset: 0; }
					88%, 100% { stroke-dashoffset: var(--len); }
				}
				@media (prefers-reduced-motion: reduce) {
					.ink { animation: none; stroke-dashoffset: 0; }
				}
			`}</style>
		</div>
	);
}
