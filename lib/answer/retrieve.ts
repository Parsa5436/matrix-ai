import { getActiveCorpusVersion } from "@/lib/db/corpus";
import { searchExemplars } from "@/lib/db/vector";
import { getApprovedMethodCard } from "@/lib/knowledge/method-cards";
import { normalizePersian } from "@/lib/knowledge/normalize";
import type { Classification } from "./classify";
import { CONFIDENT } from "./classify";
import { titlesFor } from "./topics";
import type { AnswerInput, Deps, SourceRef } from "./types";

export type RetrievedExemplar = {
	id: string;
	question: string;
	solutionMd: string;
	answer: string;
	topicTitle: string;
};

export type Retrieved = {
	exemplars: RetrievedExemplar[];
	methodCard: string | null;
	sources: SourceRef[];
	/** what retrieval actually filtered on, so the eval can score topic selection */
	topicTitles: string[];
	/** true when the topic filter came back too thin and the subject-only search was used */
	widened: boolean;
	corpusVersion: number;
};

// Two to four worked examples. More crowds the prompt without adding method: the teacher
// solves a given kind of problem the same way each time, so the fifth example repeats the
// third. Fewer than two and one unlucky retrieval defines the style.
const MAX_EXEMPLARS = 4;

// …which is also the widening condition below. One example does not establish a method, so
// a topic that yields fewer than this is worth re-searching across the whole subject.
const MIN_EXEMPLARS = 2;

export async function retrieve(
	input: AnswerInput,
	classification: Classification,
	deps: Deps,
	options: { excludeExemplarIds?: string[] } = {},
): Promise<Retrieved> {
	const corpusVersion = await getActiveCorpusVersion(deps.db);
	const useTopic =
		classification.topic !== null && classification.confidence >= CONFIDENT;
	const topicTitles =
		useTopic && classification.topic ? titlesFor(classification.topic) : [];

	// The ingest's own topic rows are what the vector table is keyed on, so the canonical
	// topic is resolved back to the titles it consolidates before it can filter anything.
	const topics = topicTitles.length
		? await deps.db.topic.findMany({
				where: { title: { in: topicTitles } },
				select: { id: true },
				orderBy: { title: "asc" },
			})
		: [];

	const normalized = normalizePersian(input.question);
	const queryEmbedding = await deps.embed(normalized);
	const excluded = new Set(options.excludeExemplarIds ?? []);

	const search = async (topicIds: string[]) => {
		const hits = await searchExemplars(deps.db, {
			queryText: normalized,
			queryEmbedding,
			subjectId: input.subjectId,
			corpusVersion,
			...(topicIds.length ? { topicIds } : {}),
			// A few extra, because the exclusion below happens after the search.
			limit: MAX_EXEMPLARS + excluded.size,
		});
		return hits.map((h) => h.id).filter((id) => !excluded.has(id));
	};

	const topicIds = topics.map((t) => t.id);
	let ids = await search(topicIds);

	// One retry, no loop: widening twice is an unfiltered search with extra steps. The
	// subject filter stays on either way — dropping it is what lets a physics question be
	// answered from a maths exemplar.
	const widened = topicIds.length > 0 && ids.length < MIN_EXEMPLARS;
	if (widened) ids = await search([]);

	// Raw SQL returned only ids; Prisma hydrates them, and the hit order is reapplied below
	// because findMany does not preserve it.
	const rows = await deps.db.exemplar.findMany({
		where: { id: { in: ids } },
		select: {
			id: true,
			question: true,
			solutionMd: true,
			answer: true,
			topic: { select: { title: true } },
		},
	});
	const byId = new Map(rows.map((r) => [r.id, r]));
	const exemplars: RetrievedExemplar[] = ids
		.slice(0, MAX_EXEMPLARS)
		.flatMap((id) => {
			const row = byId.get(id);
			return row
				? [
						{
							id: row.id,
							question: row.question,
							solutionMd: row.solutionMd,
							answer: row.answer,
							topicTitle: row.topic.title,
						},
					]
				: [];
		});

	// A separate path on purpose: exemplars are found by similarity, a method card is looked
	// up by topic. Retrieving a card by embedding would surface a card for a neighbouring
	// topic, which is exactly the confidently-wrong failure the subject filter exists to stop.
	const methodCard = await getApprovedMethodCard(
		deps.db,
		topics.map((t) => t.id),
		corpusVersion,
	);

	const sources: SourceRef[] = exemplars.map((e) => ({
		kind: "exemplar",
		id: e.id,
		label: e.topicTitle,
	}));
	if (methodCard && classification.topic) {
		sources.unshift({
			kind: "method-card",
			id: classification.topic,
			label: classification.topic,
		});
	}

	return {
		exemplars,
		methodCard,
		sources,
		topicTitles,
		widened,
		corpusVersion,
	};
}
