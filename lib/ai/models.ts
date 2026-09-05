import { env } from "@/lib/env";

export const MODELS = {
	reasoning: env.MODEL_REASONING,
	fast: env.MODEL_FAST,
	embedding: env.MODEL_EMBEDDING,
	speech: env.MODEL_SPEECH,
} as const;

type ModelRole = keyof typeof MODELS;
/** Roles that take a prompt and are billed in tokens. Embedding and speech are neither. */
export type ChatRole = Exclude<ModelRole, "embedding" | "speech">;
