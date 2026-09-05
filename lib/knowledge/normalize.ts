// The single normalizer. Ingest writes its output into contentNorm/questionNorm and
// retrieval runs the query through the same function. If the two ever diverge — by one
// rule, in one direction — recall collapses and nothing anywhere throws. That is why
// this file is pure, dependency-free, and tested.

const ARABIC_TO_PERSIAN: Record<string, string> = {
	"\u064A": "\u06CC", // ARABIC YEH        -> FARSI YEH
	"\u0649": "\u06CC", // ALEF MAKSURA      -> FARSI YEH
	"\u0643": "\u06A9", // ARABIC KAF        -> KEHEH
	"\u0629": "\u0647", // TEH MARBUTA       -> HEH
	"\u06C0": "\u0647", // HEH WITH YEH ABOVE-> HEH
	"\u0623": "\u0627", // ALEF WITH HAMZA ABOVE -> ALEF
	"\u0625": "\u0627", // ALEF WITH HAMZA BELOW -> ALEF
	"\u0671": "\u0627", // ALEF WASLA        -> ALEF
};

// Persian (U+06F0-9) and Arabic-Indic (U+0660-9) digits both fold to ASCII, so "۱۲" and
// "١٢" and "12" are one token. LaTeX and option labels are ASCII already.
const digitFold = (text: string) =>
	text.replace(/[\u06F0-\u06F9\u0660-\u0669]/g, (d) => {
		const code = d.charCodeAt(0);
		const base = code >= 0x06f0 ? 0x06f0 : 0x0660;
		return String(code - base);
	});

// Harakat, tanween, shadda, sukun, superscript alef, and the Quranic marks. All are
// optional in written Persian, so a corpus that has them and a student who does not
// would never match.
const DIACRITICS = /[\u064B-\u065F\u0670\u06D6-\u06ED]/g;

const TATWEEL = /\u0640/g;

// ZWNJ joins one Persian word (می‌رود is a single word), so it is removed rather than
// turned into a space — that keeps word identity. ZWJ, ZWSP, and a stray BOM carry no
// meaning here at all and go the same way.
const ZERO_WIDTH = /[\u200B-\u200D\uFEFF]/g;

export function normalizePersian(input: string): string {
	let text = input.normalize("NFC");
	text = text.replace(
		/[\u064A\u0649\u0643\u0629\u06C0\u0623\u0625\u0671]/g,
		(c) => ARABIC_TO_PERSIAN[c] ?? c,
	);
	text = digitFold(text);
	text = text.replace(DIACRITICS, "");
	text = text.replace(TATWEEL, "");
	text = text.replace(ZERO_WIDTH, "");
	return text.replace(/\s+/g, " ").trim();
}
