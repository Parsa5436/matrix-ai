import { describe, expect, test } from "bun:test";
import { persianMarkdownToHtml } from "./persian-markdown";

// The contract this file exists to keep: the teacher's review document must never show him
// LaTeX source, and every one of these strings is real corpus text that leaked it.
//
// Only what is painted on the page counts. KaTeX keeps the original TeX in a MathML
// <annotation> for accessibility and copy-paste; it is never rendered, so it is stripped
// here before checking — otherwise every correctly typeset formula reads as a leak.
const visibleText = (html: string) =>
	html
		.replace(/<annotation[^>]*>[\s\S]*?<\/annotation>/g, "")
		.replace(/<[^>]*>/g, "");

const leaksSource = (html: string) =>
	/\\[a-zA-Z]+|[{}]/.test(visibleText(html));

describe("persianMarkdownToHtml", () => {
	test("typesets delimited maths", () => {
		const html = persianMarkdownToHtml("مشتق $x^2$ برابر است با $2x$");
		expect(html).toContain("katex");
		expect(html).toContain('dir="ltr"');
		expect(leaksSource(html)).toBe(false);
	});

	// «چگالی آن ۱۳/۶ \frac{g}{cm^۳}» — straight off a slide, no dollars. A regex over
	// \\[a-zA-Z]+(\{[^{}]*\})* stops at the nested brace and leaves «{\frac» on the page.
	test("typesets undelimited LaTeX with nested braces", () => {
		const html = persianMarkdownToHtml(
			"چگالی آن ۱۳/۶ \\frac{\\text{g}}{\\text{cm}^۳} باشد",
		);
		expect(html).toContain("katex");
		expect(leaksSource(html)).toBe(false);
	});

	// «۱۰^{-۲}» has no backslash at all, so a command-triggered scan never sees it.
	test("typesets a brace superscript with no command", () => {
		const html = persianMarkdownToHtml("دقت اندازه‌گیری ۱۰^{-۲} متر است");
		expect(html).toContain("katex");
		expect(leaksSource(html)).toBe(false);
	});

	test("keeps the base token with its exponent", () => {
		const html = persianMarkdownToHtml("۱۰^۳ متر");
		// «۱۰» must be raised into the maths, not left stranded in the prose before it
		expect(html.replace(/<[^>]*>/g, "")).not.toMatch(/۱۰\s*$/);
		expect(html).toContain("katex");
	});

	test("leaves ordinary Persian prose alone", () => {
		const html = persianMarkdownToHtml(
			"این یک جمله‌ی ساده است بدون هیچ فرمولی.",
		);
		expect(html).toBe("<p>این یک جمله‌ی ساده است بدون هیچ فرمولی.</p>");
	});

	// The placeholder used to be spaces around an index; prose is full of spaced numerals
	// and the restore step spliced maths into the middle of ordinary sentences.
	test("does not mistake a spaced numeral in prose for a placeholder", () => {
		const html = persianMarkdownToHtml("در مرحله 2 عدد 3 را می‌نویسیم.");
		expect(html).toContain("2");
		expect(html).toContain("3");
		expect(html).not.toContain("katex");
	});

	test("renders bold and headings without exposing markers", () => {
		const html = persianMarkdownToHtml("### گام اول\n\n**پاسخ:** سی گرم");
		expect(html).toContain("<h3>گام اول</h3>");
		expect(html).toContain("<strong>پاسخ:</strong>");
		expect(html).not.toContain("**");
	});

	test("escapes HTML so corpus text cannot inject markup", () => {
		const html = persianMarkdownToHtml("اگر a < b باشد");
		expect(html).toContain("&lt;");
	});
});
