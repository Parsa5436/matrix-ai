import katex from "katex";

// Renders the model's Persian answer for print: light markdown plus typeset maths.
//
// The hard part is not markdown, it is that the corpus contains LaTeX that was never
// wrapped in $…$ — «چگالی آن ۱۳/۶ \frac{g}{cm^۳}» and «۱۰^{-۲}» come straight off the
// slides that way. Undelimited, it reaches the page as source, and the one thing the
// teacher's review document must never show him is our plumbing. A regex cannot find these
// reliably (nested braces in \frac{\text{mm}^۲}{\text{h}} defeat it), so the scanner below
// walks the string and matches braces properly.

const LATIN_OR_DIGIT = /[0-9۰-۹A-Za-z]/;

const escapeHtml = (s: string) =>
	s.replace(/[&<>]/g, (c) =>
		c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;",
	);

function renderMath(tex: string, display: boolean): string {
	try {
		const html = katex.renderToString(tex.trim(), {
			displayMode: display,
			throwOnError: false,
			errorColor: "#999",
			// The teacher writes Persian numerals inside his formulas. KaTeX has no metrics
			// for them and warns on every one; the glyphs still render from the page font, so
			// the warnings are noise that would bury a real problem.
			strict: false,
		});
		// Formulas are LTR islands in RTL prose; inline-block stops the bidi algorithm
		// reordering the words around them.
		return `<span dir="ltr" class="math${display ? " display" : ""}">${html}</span>`;
	} catch {
		return "";
	}
}

/** End index of the LaTeX run starting at `i`, or i if there is none. */
function endOfRun(text: string, i: number): number {
	let k = i;
	while (k < text.length) {
		const c = text[k] as string;
		if (c === "\\" && /[a-zA-Z]/.test(text[k + 1] ?? "")) {
			k += 2;
			while (k < text.length && /[a-zA-Z]/.test(text[k] as string)) k++;
			continue;
		}
		if (c === "{") {
			let depth = 0;
			do {
				if (text[k] === "{") depth++;
				else if (text[k] === "}") depth--;
				k++;
			} while (k < text.length && depth > 0);
			continue;
		}
		if (c === "^" || c === "_") {
			k++;
			// a bare superscript takes exactly one token
			if (text[k] && text[k] !== "{" && LATIN_OR_DIGIT.test(text[k] as string))
				k++;
			continue;
		}
		if (LATIN_OR_DIGIT.test(c)) {
			k++;
			continue;
		}
		break;
	}
	return k;
}

/** Replace undelimited LaTeX with rendered maths, leaving ordinary prose alone. */
function typesetBareLatex(
	text: string,
	stash: (tex: string, display: boolean) => string,
) {
	let out = "";
	let i = 0;
	while (i < text.length) {
		const c = text[i] as string;
		const isCommand = c === "\\" && /[a-zA-Z]/.test(text[i + 1] ?? "");
		// `^`/`_` only start a run when something precedes them to be raised or lowered.
		const isScript =
			(c === "^" || c === "_") && LATIN_OR_DIGIT.test(out.at(-1) ?? "");
		if (!isCommand && !isScript) {
			out += c;
			i++;
			continue;
		}
		let start = i;
		if (isScript) {
			// pull the base token («۱۰» of «۱۰^{-۲}») back out of the finished output
			let j = out.length;
			while (j > 0 && LATIN_OR_DIGIT.test(out[j - 1] as string)) j--;
			start = i - (out.length - j);
			out = out.slice(0, j);
		}
		const end = endOfRun(text, i);
		if (end <= i) {
			out += c;
			i++;
			continue;
		}
		out += stash(text.slice(start, end), false);
		i = end;
	}
	return out;
}

export function persianMarkdownToHtml(markdown: string): string {
	const math: string[] = [];
	const stash = (tex: string, display: boolean) => {
		math.push(renderMath(tex, display));
		return `\uE000${math.length - 1}\uE000`;
	};

	let text = markdown
		.replace(/\$\$([\s\S]+?)\$\$/g, (_, tex: string) => stash(tex, true))
		.replace(/\$([^$\n]+?)\$/g, (_, tex: string) => stash(tex, false));
	text = typesetBareLatex(text, stash);

	text = escapeHtml(text)
		.replace(/^\s*#{1,6}\s*(.+)$/gm, "<h3>$1</h3>")
		.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

	const blocks = text
		.split(/\n{2,}/)
		.map((block) => {
			const trimmed = block.trim();
			if (!trimmed) return "";
			if (trimmed.startsWith("<h3>")) return trimmed;
			return `<p>${trimmed.replace(/\n/g, "<br>")}</p>`;
		})
		.join("\n");

	return blocks.replace(
		/\uE000(\d+)\uE000/g,
		(_, i: string) => math[Number(i)] ?? "",
	);
}

/** Same, for a short fragment that should not be wrapped in a paragraph. */
export const persianInlineToHtml = (text: string) =>
	persianMarkdownToHtml(text).replace(/^<p>|<\/p>$/g, "");
