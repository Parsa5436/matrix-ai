import { z } from "zod";

const EnvSchema = z.object({
	DATABASE_URL: z.url(),

	// Signs the session cookie. Rotating it logs everyone out, which is the intended
	// emergency lever since there are no session rows to revoke.
	SESSION_SECRET: z.string().min(32),

	AI_BASE_URL: z.url(),
	AI_API_KEY: z.string().min(1),
	AI_FALLBACK_BASE_URL: z.union([z.url(), z.literal("")]).default(""),
	AI_FALLBACK_API_KEY: z.string().default(""),

	MODEL_REASONING: z.string().min(1),
	MODEL_FAST: z.string().min(1),
	MODEL_EMBEDDING: z.string().min(1),

	// Speech. The three move together: a model, one of its own voice names, and the only
	// container it will emit. Gemini TTS refuses anything but pcm; Grok emits mp3. Getting the
	// pairing wrong is a 400, not a silent downgrade.
	//
	// google/gemini-3.1-flash-tts-preview is wired and reads Persian just as well — but MEASURED
	// on this gateway it does not finish a real narration. 200 and 400 characters come back in
	// 10-23s; 700 timed out on one attempt in three; our ~1500-character scripts never returned
	// at all (180s and 300s). Grok does the same script in 18s, every time, in a third of the
	// bytes. Re-measure with `bun run probe:tts` before switching.
	MODEL_SPEECH: z.string().min(1).default("x-ai/grok-voice-tts-1.0"),
	// ara — "warm and conversational". All five Grok voices read Persian verbatim in the probe,
	// so the choice is character rather than accuracy: a teacher explaining, not an announcer.
	// Gemini's equivalents are Charon (informative), Aoede (breezy), Achernar (soft).
	SPEECH_VOICE: z.string().min(1).default("ara"),
	SPEECH_FORMAT: z.enum(["mp3", "pcm"]).default("mp3"),
	EMBEDDING_DIM: z.coerce.number().int().positive(),

	// How much context one conversation may fill before it stops taking new messages. Well
	// under the model's own window on purpose — a conversation that long has stopped being
	// one question, and the student is better served starting a new chat than paying for a
	// quarter-million tokens of history on every turn.
	//
	// Configured rather than discovered: tokenlens has no entry for our model id, and the
	// gateway's model list returns ids without context lengths. It is also the number the
	// usage ring is drawn against, so the ring fills as the refusal approaches.
	CONTEXT_LIMIT_TOKENS: z.coerce.number().int().positive().default(250_000),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
	throw new Error(
		`Invalid environment (see .env.example):\n${z.prettifyError(parsed.error)}`,
	);
}

export const env = parsed.data;
