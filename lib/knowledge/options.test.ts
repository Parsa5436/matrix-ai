import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Glob } from "bun";
import { toPersianDigits } from "@/lib/persian";
import { asAsked, cleanOption, cleanOptions } from "./options";

describe("cleanOption", () => {
	test("strips a leading label", () => {
		expect(cleanOption("۱) ۱/۵۷", 0)).toBe("۱/۵۷");
		expect(cleanOption("3. ۲/۴", 2)).toBe("۲/۴");
	});

	test("strips a trailing label", () => {
		expect(cleanOption("۷/۷۵ ۱", 0)).toBe("۷/۷۵");
	});

	test("leaves an option that only looks like a label alone", () => {
		// option 3 whose value really is ۲ — the label to strip would be ۳, not ۲
		expect(cleanOption("۲", 2)).toBe("۲");
	});

	test("repairs a superscript the extraction read as a latin r", () => {
		expect(cleanOptions(["۱۰^r"])).toEqual(["۱۰^۲"]);
	});
});

describe("toPersianDigits", () => {
	test("converts every ASCII digit and leaves the rest alone", () => {
		expect(toPersianDigits("0123456789")).toBe("۰۱۲۳۴۵۶۷۸۹");
		expect(toPersianDigits("گزینه 3")).toBe("گزینه ۳");
		expect(toPersianDigits("۱۲")).toBe("۱۲");
	});
});

describe("asAsked", () => {
	test("puts the options in the question", () => {
		const asked = asAsked({
			question: "کدام درست است؟",
			options: ["الف", "ب"],
		});
		expect(asked).toContain("کدام درست است؟");
		expect(asked).toContain("1) الف");
		expect(asked).toContain("2) ب");
	});

	test("leaves a question with no options untouched", () => {
		expect(asAsked({ question: "چگالی چیست؟", options: [] })).toBe(
			"چگالی چیست؟",
		);
		expect(asAsked({ question: "چگالی چیست؟", options: null })).toBe(
			"چگالی چیست؟",
		);
	});
});

// The defect this file exists for is never inside asAsked — it is a caller that never
// reached it. It has happened twice: the eval harness sent the bare stem, and after that was
// fixed the review script did the same, and in both cases the model solved the physics and
// then asked the student to send the options.
//
// The stem and the options are separate columns; the pipeline takes one string. So a call
// site that hands `row.question` straight to answer() is asking a multiple-choice question
// without its choices. The student's own typed message is not a stored row and is fused
// already, which is why the rule is about the property access and not about asAsked.
/** The input object of every `answer({ … })` call in a source file. */
function answerInputs(source: string): string[] {
	const inputs: string[] = [];
	for (const match of source.matchAll(/\banswer\(\s*\{/g)) {
		const open = source.indexOf("{", match.index);
		let depth = 0;
		let i = open;
		for (; i < source.length; i++) {
			if (source[i] === "{") depth++;
			else if (source[i] === "}" && --depth === 0) break;
		}
		inputs.push(source.slice(open + 1, i));
	}
	return inputs;
}

/** The same text with every nested group blanked out, so only this object's own keys remain. */
function outerOnly(text: string): string {
	let out = "";
	let depth = 0;
	for (const c of text) {
		if (c === "(" || c === "{" || c === "[") depth++;
		else if (c === ")" || c === "}" || c === "]") depth--;
		else if (depth === 0) out += c;
	}
	return out;
}

const BARE_STEM = /question:\s*[A-Za-z_$][\w$]*\.question\b/;

test("no caller asks answer() with a bare stored question", () => {
	const files = ["app", "lib", "scripts"].flatMap((dir) => [
		...new Glob(`${dir}/**/*.ts`).scanSync("."),
	]);
	const offenders: string[] = [];

	for (const file of files) {
		if (file.endsWith(".test.ts")) continue;
		for (const input of answerInputs(readFileSync(file, "utf8"))) {
			const bare = BARE_STEM.exec(outerOnly(input));
			if (bare) offenders.push(`${file} — ${bare[0]}`);
		}
	}

	expect(offenders).toEqual([]);
	// and the scan really is reaching the call sites it claims to guard
	expect(files.some((f) => f.endsWith("review.ts"))).toBe(true);
	expect(
		BARE_STEM.test(outerOnly("question: row.question, subjectId: x")),
	).toBe(true);
});
