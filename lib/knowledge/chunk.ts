// Heading-aware splitting. The shape below is the input contract for the client's
// cleaned Markdown: h1 = chapter, h2 = topic, h3 beginning with مثال/تست/نمونه = a solved
// problem, everything else under a topic = prose worth keeping as a chunk.

export type ParsedExemplar = { heading: string; body: string };

export type ParsedTopic = {
	chapterTitle: string;
	topicTitle: string;
	chunks: string[];
	exemplars: ParsedExemplar[];
};

// No \b here: JavaScript word boundaries are defined on ASCII word characters, so
// /^مثال\b/ never matches "مثال ۱" and every worked problem is silently filed as prose.
const PROBLEM_HEADING = /^(مثال|تست|نمونه|تمرین)/;

// $$…$$ first so a display block is not read as two inline spans. Neither pattern
// crosses a blank line: a display span is one thought, and letting it span blank
// lines made KaTeX validate swallowed prose as a "formula" (or flag it as broken).
// [^\n] or a newline not followed by another newline — single line breaks pass,
// blank lines end the span. The outer group must stay CAPTURING: extractFormulas
// reads the interior by index, and a non-capturing group hands it undefined.
const DISPLAY_MATH = /\$\$((?:[^\n]|\n(?!\n))+?)\$\$/g;
const INLINE_MATH = /(?<!\$)\$([^$\n]+?)\$(?!\$)/g;

export function extractFormulas(markdown: string): string[] {
	const found: string[] = [];
	for (const [, body] of markdown.matchAll(DISPLAY_MATH))
		if (body) found.push(body.trim());
	for (const [, body] of markdown.matchAll(INLINE_MATH))
		if (body) found.push(body.trim());
	return found;
}

export function parseMarkdown(markdown: string): ParsedTopic[] {
	const topics: ParsedTopic[] = [];
	let chapterTitle = "";
	let topic: ParsedTopic | null = null;
	let exemplar: ParsedExemplar | null = null;
	let buffer: string[] = [];

	const flushBuffer = () => {
		const text = buffer.join("\n").trim();
		buffer = [];
		if (!text || !topic) return;
		if (exemplar) exemplar.body = text;
		else
			for (const para of text.split(/\n{2,}/))
				if (para.trim()) topic.chunks.push(para.trim());
	};

	const closeExemplar = () => {
		flushBuffer();
		if (exemplar && topic) topic.exemplars.push(exemplar);
		exemplar = null;
	};

	for (const line of markdown.split("\n")) {
		const heading = /^(#{1,3})\s+(.*)$/.exec(line);
		if (!heading) {
			buffer.push(line);
			continue;
		}
		const [, hashes, rawTitle = ""] = heading;
		const title = rawTitle.trim();

		if (hashes === "#") {
			closeExemplar();
			if (topic) topics.push(topic);
			topic = null;
			chapterTitle = title;
		} else if (hashes === "##") {
			closeExemplar();
			if (topic) topics.push(topic);
			topic = { chapterTitle, topicTitle: title, chunks: [], exemplars: [] };
		} else {
			closeExemplar();
			if (PROBLEM_HEADING.test(title)) exemplar = { heading: title, body: "" };
			else buffer.push(title);
		}
	}

	closeExemplar();
	if (topic) topics.push(topic);
	return topics;
}
