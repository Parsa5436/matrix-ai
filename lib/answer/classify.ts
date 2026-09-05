import { generateJson, JsonExtractionError } from "@/lib/ai/json";
import { CLASSIFY_INSTRUCTIONS } from "@/lib/ai/prompts";
import { ClassificationSchema } from "@/lib/ai/schemas";
import { CANONICAL_TOPICS, type CanonicalTopic } from "./topics";
import type { Deps } from "./types";

export type Classification = {
	kind: "general" | "educational";
	topic: CanonicalTopic | null;
	/** Below CONFIDENT the topic is treated as a guess and retrieval does not filter on it. */
	confidence: number;
};

// A topic filter that is wrong is worse than no topic filter: it excludes the exemplars
// that would have answered the question, and the fallback looks like a retrieval miss
// rather than a classification miss. So an unconfident topic is dropped, not used.
export const CONFIDENT = 0.6;

export async function classify(
	question: string,
	deps: Pick<Deps, "llm">,
): Promise<Classification> {
	try {
		const result = await generateJson(deps, {
			role: "fast",
			instructions: CLASSIFY_INSTRUCTIONS,
			prompt: `${question}\n\nموضوع‌های ممکن:\n${CANONICAL_TOPICS.map((t) => `- ${t}`).join("\n")}`,
			schema: ClassificationSchema,
		});
		const topic = CANONICAL_TOPICS.find((t) => t === result.topic) ?? null;
		return { kind: result.kind, topic, confidence: result.confidence };
	} catch (error) {
		// Classification is a routing decision, not the answer. If the fast model will not
		// produce valid JSON, degrade to an unfiltered educational search rather than failing
		// the whole request — the student still gets an answer, just a less targeted one.
		if (!(error instanceof JsonExtractionError)) throw error;
		console.error(
			"[classify] falling back to unfiltered educational",
			error.message,
		);
		return { kind: "educational", topic: null, confidence: 0 };
	}
}
