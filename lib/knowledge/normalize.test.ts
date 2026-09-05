import { describe, expect, test } from "bun:test";
import { normalizePersian } from "./normalize";

describe("normalizePersian", () => {
	test("folds Arabic letters onto their Persian forms", () => {
		expect(normalizePersian("كتاب عربي")).toBe("کتاب عربی");
		expect(normalizePersian("مدرسة")).toBe("مدرسه");
		expect(normalizePersian("أحمد إسلام")).toBe("احمد اسلام");
	});

	test("folds Persian and Arabic-Indic digits onto ASCII", () => {
		expect(normalizePersian("۱۲۳")).toBe("123");
		expect(normalizePersian("١٢٣")).toBe("123");
		expect(normalizePersian("سؤال ۴")).toBe("سؤال 4");
	});

	test("strips diacritics and tatweel", () => {
		expect(normalizePersian("مُشتَقّ")).toBe("مشتق");
		expect(normalizePersian("رياضـــيات")).toBe("ریاضیات");
	});

	test("removes zero-width characters so ZWNJ compounds are one token", () => {
		expect(normalizePersian("می\u200Cرود")).toBe("میرود");
		expect(normalizePersian("\uFEFFنیم\u200Cفاصله")).toBe("نیمفاصله");
	});

	test("collapses whitespace and trims", () => {
		expect(normalizePersian("  دو   کلمه \n\t سه  ")).toBe("دو کلمه سه");
	});

	test("leaves LaTeX and Latin text intact apart from spacing", () => {
		expect(normalizePersian("مشتق $f(x) = x^2$ برابر است با $2x$")).toBe(
			"مشتق $f(x) = x^2$ برابر است با $2x$",
		);
	});

	// The property that actually matters: the same input written two plausible ways by
	// a corpus author and by a student must land on the same string.
	test("converges the corpus spelling and the student spelling", () => {
		const corpus = "مشتقِ تابعِ نمايي ۲";
		const student = "مشتق تابع نمایی 2";
		expect(normalizePersian(corpus)).toBe(normalizePersian(student));
	});

	test("is idempotent", () => {
		const once = normalizePersian("كتابِ ریاضـي ۱۲۳ می\u200Cشود");
		expect(normalizePersian(once)).toBe(once);
	});
});
