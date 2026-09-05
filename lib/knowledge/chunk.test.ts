import { describe, expect, test } from "bun:test";
import { extractFormulas, parseMarkdown } from "./chunk";

const DOC = `# فصل اول

## موضوع یک

پاراگراف اول است.

پاراگراف دوم است.

### مثال ۱

صورت مسئله.

پاسخ: $2x$

### تست ۲

صورت تست.

## موضوع دو

تنها پاراگراف این موضوع.
`;

describe("parseMarkdown", () => {
	const topics = parseMarkdown(DOC);

	test("splits on h2 into topics, carrying the h1 chapter down", () => {
		expect(topics.map((t) => t.topicTitle)).toEqual(["موضوع یک", "موضوع دو"]);
		expect(topics.every((t) => t.chapterTitle === "فصل اول")).toBe(true);
	});

	// The bug this guards: `\b` is ASCII-only in JavaScript, so /^مثال\b/ never matched a
	// Persian heading and every worked problem was silently filed as prose instead.
	test("recognises Persian problem headings", () => {
		expect(topics[0]?.exemplars.map((e) => e.heading)).toEqual([
			"مثال ۱",
			"تست ۲",
		]);
	});

	test("keeps exemplar bodies out of the prose chunks", () => {
		expect(topics[0]?.chunks).toEqual([
			"پاراگراف اول است.",
			"پاراگراف دوم است.",
		]);
		expect(topics[0]?.exemplars[0]?.body).toContain("صورت مسئله.");
	});

	test("a topic with no problems still yields its prose", () => {
		expect(topics[1]?.chunks).toEqual(["تنها پاراگراف این موضوع."]);
		expect(topics[1]?.exemplars).toEqual([]);
	});
});

describe("extractFormulas", () => {
	test("finds inline and display math, and does not span blank lines", () => {
		expect(extractFormulas("مشتق $x^2$ و $$\\int x\\,dx$$ است")).toEqual([
			"\\int x\\,dx",
			"x^2",
		]);
	});

	// The bug this guards: [^$] matches newlines, so a display span swallowed the next
	// paragraph across a blank line and KaTeX validated prose as a "formula".
	test("a display block cannot cross a blank line, but keeps single line breaks", () => {
		expect(extractFormulas("$$\nx^2\n\n\\text{متن بلعیده شده}\n$$")).toEqual(
			[],
		);
		expect(extractFormulas("$$\n\\int x\\,dx\n$$")).toEqual(["\\int x\\,dx"]);
	});

	test("returns the broken formula so KaTeX can reject it", () => {
		expect(extractFormulas("گزینه د) $\\frac{1}{5$")).toEqual(["\\frac{1}{5"]);
	});
});
