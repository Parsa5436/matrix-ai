// Consolidate the drafted method cards down to one per canonical topic, then — separately,
// only once a teacher has read them — approve them.
//
//   bun run cards            merge 66 drafts into 6, write content/derived/method-cards.md
//   bun run cards --apply    replace the cards in the database from that file, approved
//
// Two commands on purpose. The merge writes a file and touches nothing; the file is what the
// teacher reads, and he can edit it in place before it is applied, which is the only way his
// exact wording survives a machine that was asked to preserve it. `--apply` is the approval,
// so it is the one that sets teacherApproved.

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { generateText } from "ai";
import { generateJson } from "@/lib/ai/json";
import {
	CHECK_METHOD_CARD_INSTRUCTIONS,
	MERGE_METHOD_CARDS_INSTRUCTIONS,
} from "@/lib/ai/prompts";
import { languageModel } from "@/lib/ai/provider";
import { CardGroundingSchema } from "@/lib/ai/schemas";
import {
	CANONICAL_TOPICS,
	type CanonicalTopic,
	canonicalTopic,
	titlesFor,
} from "@/lib/answer/topics";
import { prisma } from "@/lib/db/client";
import { getActiveCorpusVersion } from "@/lib/db/corpus";
import { normalizePersian } from "@/lib/knowledge/normalize";

const OUT = resolve("content/derived/method-cards.md");
const FLAGS = resolve("content/derived/method-cards-flags.md");
const MARKER = (topic: string) => `<!-- topic: ${topic} -->`;

const corpusVersion = await getActiveCorpusVersion(prisma);

const cards = await prisma.methodCard.findMany({
	where: { corpusVersion },
	include: { topic: { select: { id: true, title: true } } },
	orderBy: { topic: { title: "asc" } },
});

const byCanonical = new Map<string, typeof cards>();
for (const card of cards) {
	const topic = canonicalTopic(card.topic.title);
	if (!topic) continue;
	byCanonical.set(topic, [...(byCanonical.get(topic) ?? []), card]);
}

// ── apply ────────────────────────────────────────────────────────────────────
if (process.argv.includes("--apply")) {
	const file = await readFile(OUT, "utf8").catch(() => {
		console.error(`Missing ${OUT}. Run \`bun run cards\` first.`);
		process.exit(1);
	});

	let replaced = 0;
	for (const topic of CANONICAL_TOPICS) {
		const start = file.indexOf(MARKER(topic));
		if (start < 0) {
			console.error(`No section for «${topic}» in ${OUT}`);
			process.exit(1);
		}
		const from = start + MARKER(topic).length;
		const next = CANONICAL_TOPICS.map((t) => file.indexOf(MARKER(t), from))
			.filter((i) => i > 0)
			.sort((a, b) => a - b)[0];
		const contentMd = file.slice(from, next ?? file.length).trim();
		if (!contentMd) {
			console.error(`Empty card for «${topic}»`);
			process.exit(1);
		}

		const group = byCanonical.get(topic) ?? [];
		// Filed against the group's first topic row. A card describes the canonical topic, not
		// the one ingest name it happens to hang off; retrieval looks it up across the whole
		// group, so which row holds it only has to be stable.
		const home = group[0];
		if (!home) {
			console.error(`No topic row for «${topic}»`);
			process.exit(1);
		}

		await prisma.$transaction([
			prisma.methodCard.deleteMany({
				where: { corpusVersion, id: { in: group.map((c) => c.id) } },
			}),
			prisma.methodCard.create({
				data: {
					topicId: home.topicId,
					corpusVersion,
					contentMd,
					teacherApproved: true,
				},
			}),
		]);
		replaced++;
		console.log(
			`  ${topic} -> ${home.topic.title} (${contentMd.length} chars)`,
		);
	}

	const left = await prisma.methodCard.count({ where: { corpusVersion } });
	const approved = await prisma.methodCard.count({
		where: { corpusVersion, teacherApproved: true },
	});
	console.log(
		`\n${replaced} card(s) applied. ${left} total, ${approved} approved.`,
	);
	await prisma.$disconnect();
	process.exit(0);
}

// ── merge ────────────────────────────────────────────────────────────────────
// Every source line worth keeping, so the merge can be checked rather than trusted. Headings
// and list bullets are structure; what matters is whether his rules survived word for word.
const ruleLines = (text: string) =>
	text
		.split("\n")
		.map((l) => l.replace(/^[\s*\-#>]+/, "").trim())
		.filter((l) => l.length >= 15);

console.log(
	`merging ${cards.length} card(s) into ${CANONICAL_TOPICS.length}...`,
);

const merged: { topic: CanonicalTopic; contentMd: string; sources: number }[] =
	[];
const dropped: { topic: string; line: string }[] = [];

for (const topic of CANONICAL_TOPICS) {
	const group = byCanonical.get(topic) ?? [];
	if (group.length === 0) {
		console.log(`  ${topic}: no drafts`);
		continue;
	}

	const body = group
		.map((c) => `## ${c.topic.title}\n\n${c.contentMd}`)
		.join("\n\n---\n\n");

	// One draft needs no merge, and asking a model to "merge" it only invites a rewrite.
	const contentMd =
		group.length === 1
			? (group[0]?.contentMd.trim() ?? "")
			: (
					await generateText({
						model: languageModel("reasoning"),
						instructions: MERGE_METHOD_CARDS_INSTRUCTIONS,
						prompt: `موضوع: ${topic}\n\n${body}`,
						// Deduplicating someone else's sentences is not a creative task, and a card
						// that comes out different on every run cannot be reviewed: the teacher would
						// be approving one sample of a distribution.
						temperature: 0,
					})
				).text.trim();

	const haystack = normalizePersian(contentMd);
	for (const card of group) {
		for (const line of ruleLines(card.contentMd)) {
			if (!haystack.includes(normalizePersian(line)))
				dropped.push({ topic, line });
		}
	}

	merged.push({ topic, contentMd, sources: group.length });
	console.log(
		`  ${topic}: ${group.length} draft(s) -> ${contentMd.length} chars`,
	);
}

// The card line carries markdown the audit's quote of it does not, so «* **تخمین:** …» and
// «تخمین: …» compare unequal and the claim survives the strip. Compare the prose only.
const plain = (text: string) =>
	normalizePersian(text)
		.replace(/[*_#>-]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();

// ── grounding ────────────────────────────────────────────────────────────────
// The drafting instructions told the fast model not to add textbook advice the teacher never
// gave. An instruction is not an enforcement, and an approved card is quoted into every
// answer on its topic under his name — so each card is read back against his own material.
console.log("\nchecking each card against his slides...");
const flagged: {
	topic: string;
	claim: string;
	why: string;
	removed: boolean;
}[] = [];

for (const { topic } of merged) {
	const topics = await prisma.topic.findMany({
		where: { title: { in: titlesFor(topic) } },
		select: { id: true },
	});
	const topicIds = topics.map((t) => t.id);
	const [chunks, exemplars] = await Promise.all([
		prisma.chunk.findMany({
			where: { corpusVersion, topicId: { in: topicIds } },
			select: { content: true },
		}),
		prisma.exemplar.findMany({
			where: { corpusVersion, topicId: { in: topicIds } },
			select: { question: true, solutionMd: true },
		}),
	]);
	const source = [
		...chunks.map((c) => c.content),
		...exemplars.map((e) => `${e.question}\n${e.solutionMd}`),
	].join("\n\n---\n\n");

	const card = merged.find((m) => m.topic === topic);
	// Three passes, unioned. One pass is not a scan: run twice over the same card and it
	// flags a different subset each time, so a single audit reports "6 problems" for a card
	// that has ten. False positives are cheap here — they land in the flags file where the
	// teacher can put them back — and a missed fabrication ships.
	const passes = await Promise.all(
		[0, 1, 2].map(() =>
			generateJson(
				{ llm: languageModel },
				{
					role: "reasoning",
					instructions: CHECK_METHOD_CARD_INSTRUCTIONS,
					prompt: `SOURCE — the teacher's own slides:\n\n${source}\n\n=====\n\nCARD to audit:\n\n${card?.contentMd ?? ""}`,
					schema: CardGroundingSchema,
				},
			).catch(() => ({ unsupported: [] })),
		),
	);
	const seen = new Set<string>();
	const unsupported = passes
		.flatMap((p) => p.unsupported)
		.filter((u) => {
			const key = plain(u.claim);
			if (key.length === 0 || seen.has(key)) return false;
			seen.add(key);
			return true;
		});
	// Removed, not just noted. An approved card is quoted into the prompt whole, so a claim
	// left in "for the teacher to notice" is a claim that ships. The wording is kept verbatim
	// in the flags file, so anything he recognises as his own can go back in.
	if (card) {
		const hits = (text: string, claim: string) =>
			text
				.split("\n")
				.some(
					(line) =>
						plain(line).length > 0 &&
						(plain(line).includes(claim) || claim.includes(plain(line))),
				);

		for (const u of unsupported) {
			const claim = plain(u.claim);
			card.contentMd = card.contentMd
				.split("\n")
				.filter((line) => {
					const l = plain(line);
					return !(l.length > 0 && (l.includes(claim) || claim.includes(l)));
				})
				.join("\n");
		}
		card.contentMd = card.contentMd.replace(/\n{3,}/g, "\n\n").trim();

		// Judged against the finished card, not against the edit that targeted it. Passes
		// return overlapping variants of the same sentence, so the second variant removes
		// nothing and would report itself as a miss when the text is already gone.
		for (const u of unsupported) {
			flagged.push({
				topic,
				...u,
				removed: !hits(card.contentMd, plain(u.claim)),
			});
		}
	}
	console.log(`  ${topic}: ${unsupported.length} ungrounded claim(s)`);
}

const unlocated = flagged.filter((f) => !f.removed);
if (unlocated.length) {
	console.log(
		`\n${unlocated.length} flagged claim(s) could not be matched to a line and are still in the card:`,
	);
	for (const u of unlocated)
		console.log(`  [${u.topic}] ${u.claim.slice(0, 90)}`);
}

await writeFile(
	FLAGS,
	[
		"# ادعاهای بدون پشتوانه در کارت‌های روش",
		"",
		"<!-- Written by `bun run cards`. Each line is a claim the card made that could not be traced",
		"     back to the teacher's slides, and has been REMOVED from method-cards.md. Anything here",
		"     you recognise as his, paste back into that file before `bun run cards --apply`. -->",
		"",
		...(flagged.length === 0
			? ["هیچ ادعای بدون پشتوانه‌ای پیدا نشد."]
			: CANONICAL_TOPICS.flatMap((t) => {
					const rows = flagged.filter((f) => f.topic === t);
					return rows.length
						? [
								`## ${t}`,
								"",
								...rows.map((r) => `- ${r.claim}\n  <!-- ${r.why} -->`),
								"",
							]
						: [];
				})),
	].join("\n"),
);

const file = [
	"# کارت‌های روش — فیزیک دهم، فصل اول",
	"",
	"<!-- Generated by `bun run cards`. Edit freely: `bun run cards --apply` loads THIS file",
	"     into the database and marks it teacher-approved. The markers below are the split",
	"     points — leave them in place. -->",
	"",
	...merged.flatMap((m) => [MARKER(m.topic), "", m.contentMd, ""]),
].join("\n");

await writeFile(OUT, file);

const sourceLines = merged.reduce(
	(n, m) =>
		n +
		(byCanonical.get(m.topic) ?? []).flatMap((c) => ruleLines(c.contentMd))
			.length,
	0,
);
// Line-exact, so any reflow counts as a miss and most of this number is the per-draft
// headings being merged away. It is a smoke alarm for a merge that threw away half a topic,
// not a fidelity score — the grounding check below is the one that means something.
console.log(
	`\n${dropped.length}/${sourceLines} source line(s) not present verbatim (line-exact: reflow counts)`,
);
console.log(`${flagged.length} ungrounded claim(s) removed to the flags file`);

console.log(`\ncards   ${OUT}`);
console.log(`flags   ${FLAGS}`);
console.log("read both, edit the cards, then: bun run cards --apply");

await prisma.$disconnect();
