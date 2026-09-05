import { embedMany } from "ai";
import { env } from "@/lib/env";
import { embeddingModel } from "./provider";

// gemini-embedding-2 dropped the `task_type` request field — the backend accepts and
// ignores it — and moved task conditioning into the text itself. Queries and passages
// therefore carry different prefixes, and getting this wrong costs recall with no error
// anywhere. Confirmed empirically (the prefix changes the returned vector) and from
// run-llama/llama_index#21535; Google's own reference does not spell it out. If the
// model changes, this is the one place to change with it.
const asQuery = (text: string) => `task: search result | query: ${text}`;
const asPassage = (text: string) => `title: none | text: ${text}`;

// Asked for explicitly rather than left to a provider default: the probe confirmed the
// gateway honours it, and the schema's vector(768) cannot adapt if it silently changes.
const providerOptions = { avalai: { dimensions: env.EMBEDDING_DIM } };

export async function embedPassages(texts: string[]): Promise<number[][]> {
	if (texts.length === 0) return [];
	const { embeddings } = await embedMany({
		model: embeddingModel(),
		values: texts.map(asPassage),
		providerOptions,
	});
	return embeddings;
}

export async function embedQuery(text: string): Promise<number[]> {
	const { embeddings } = await embedMany({
		model: embeddingModel(),
		values: [asQuery(text)],
		providerOptions,
	});
	const embedding = embeddings[0];
	if (!embedding) throw new Error("embedQuery: provider returned no embedding");
	return embedding;
}
