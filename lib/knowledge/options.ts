import { PERSIAN_DIGITS } from "@/lib/persian";

// Everything about a stored multiple-choice option: how to repair it, and how to ask it.
//
// The VLM fused an option's label into its text — sometimes leading («۱) ۱/۵۷»), sometimes
// trailing («۷/۷۵ ۱») — and read a superscript ۲ as a Latin 'r' often enough to be worth
// naming. Both are patterns across the corpus rather than one-off records, so they are
// repaired by rule here and every reader gets the same clean text: the eval, the teacher's
// review document, and anything later that shows an option to a student.

/** Strip the option's own label from its text, given the option's zero-based position. */
function stripFusedLabel(option: string, index: number): string {
	const ascii = String(index + 1);
	const persian = PERSIAN_DIGITS[index + 1] ?? ascii;
	return option
		.replace(new RegExp(`^\\s*[${ascii}${persian}]\\s*[).\\-]\\s*`), "")
		.replace(new RegExp(`\\s+[${ascii}${persian}]\\s*$`), "")
		.trim();
}

const fixSuperscripts = (option: string) => option.replace(/\^r\b/g, "^۲");

export const cleanOption = (option: string, index: number) =>
	fixSuperscripts(stripFusedLabel(option, index));

export const cleanOptions = (options: string[]) => options.map(cleanOption);

// A multiple-choice question has to be ASKED as one. The stem and the options live in
// separate columns, but the pipeline takes a single string — so every caller holding both
// has to fuse them, and twice now one has forgotten: the model solved the physics and then
// asked the student to send the options.
//
// This is the one place that fusion happens. `options.test.ts` scans the call sites, because
// the defect is never in this function — it is in a caller that never reached it.
export function asAsked(item: {
	question: string;
	options?: string[] | null;
}): string {
	const options = item.options ?? [];
	if (options.length === 0) return item.question;
	return `${item.question}\n\nگزینه‌ها:\n${options
		.map((o, i) => `${i + 1}) ${o}`)
		.join("\n")}\n\nدر پایان، شماره‌ی گزینه‌ی درست را صریح بنویس.`;
}
