// LaTeX inside a prompt decays silently, and the source looks fine while it does.
//
// In a plain template literal `\frac` is the unknown escape `\f` and collapses to a formfeed,
// `\rho` to a carriage return, `\mathrm` just loses its backslash. Writing `\\frac` to survive
// that delivers a literal `\\frac` instead, which is equally not LaTeX — and a formatter run
// can move a prompt between those two states without changing a character you can see.
//
// So the prompts write `\\frac`, which is exactly one backslash at runtime. String.raw is NOT
// an alternative here: Bun's transpiler escapes non-ASCII into the raw strings array, so a
// String.raw template hands the model a literal `ت` for every Persian character.
//
// This checks the RUNTIME strings, because that is the only version the model ever sees.

import * as prompts from "@/lib/ai/prompts";

// `\command{` with the backslash missing. The trailing brace is what makes this a LaTeX
// command rather than the English word "text" or "left" sitting in a sentence.
const DEBACKSLASHED =
	/(^|[^\\])\b(mathrm|frac|dfrac|cfrac|times|cdot|left|right|mathbf|text|sqrt)\{/g;

let damaged = 0;

for (const [name, value] of Object.entries(prompts)) {
	if (typeof value !== "string") continue;

	const doubled = [...new Set(value.match(/\\\\[a-zA-Z]+/g) ?? [])];
	const control = (value.match(/[\r\f\v]/g) ?? []).length;
	const lost = [
		...new Set([...value.matchAll(DEBACKSLASHED)].map((m) => m[2])),
	];
	const commands = [...new Set(value.match(/\\[a-zA-Z]+/g) ?? [])];

	if (doubled.length || control || lost.length) {
		damaged++;
		console.error(`FAIL  ${name}`);
		if (doubled.length)
			console.error(`        double-escaped: ${doubled.join(" ")}`);
		if (lost.length)
			console.error(`        lost its backslash: ${lost.join(" ")}`);
		if (control)
			console.error(
				`        ${control} control char(s) from a collapsed escape`,
			);
	} else if (commands.length) {
		console.log(`ok    ${name.padEnd(30)} ${commands.join(" ")}`);
	}
}

if (damaged) {
	console.error(
		`\n${damaged} prompt(s) damaged. Write LaTeX as \\\\command in the source — not \\command, not String.raw.`,
	);
	process.exit(1);
}
console.log("\nEvery LaTeX-bearing prompt is intact.");
