import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { env } from "@/lib/env";
import { type ChatRole, MODELS } from "./models";

const avalai = createOpenAICompatible({
	name: "avalai",
	baseURL: env.AI_BASE_URL,
	apiKey: env.AI_API_KEY,
});

// Primary only, and knowingly so. Failover belongs here as a custom `fetch` that retries a
// network error or 5xx against AI_FALLBACK_BASE_URL and never retries a 4xx — but there is
// still no second account to test it against, and untested failover is worse than none.
// Write it against a real fallback key, by disabling the primary and watching it switch.
export const languageModel = (role: ChatRole) => avalai.chatModel(MODELS[role]);

export const embeddingModel = () => avalai.embeddingModel(MODELS.embedding);

// Speech comes from a second client because @ai-sdk/openai-compatible ships chat, completion,
// embedding and image models — no speech model. @ai-sdk/openai does, and it posts exactly
// `{ model, input, voice, response_format }` to `${baseURL}/audio/speech`, which is the shape
// both OpenRouter and AvalAI expose. Same base URL, same key, so the gateway is still owned
// in one file.
const speech = createOpenAI({
	baseURL: env.AI_BASE_URL,
	apiKey: env.AI_API_KEY,
});

export const speechModel = () => speech.speech(MODELS.speech);
