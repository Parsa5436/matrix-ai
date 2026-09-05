import { createHash } from "node:crypto";
import { generateSpeech, generateText, type SpeechModel } from "ai";
import { NARRATION_INSTRUCTIONS } from "@/lib/ai/prompts";
import { env } from "@/lib/env";
import type { Deps } from "./types";

export type Narration = {
	script: string;
	audio: Uint8Array;
	/** sha-256 of the script. Names the file, so identical narrations cost one generation. */
	hash: string;
	extension: "mp3" | "wav";
};

// Gemini TTS returns raw 24 kHz mono signed-16-bit samples and nothing else — no container,
// no header, so no player can open it. These 44 bytes are that header. It is here rather than
// in a dependency because a WAV header is a fixed struct and an encoder would be a megabyte
// of code to write out numbers we already know.
const PCM_RATE = 24_000;

function toWav(pcm: Uint8Array): Uint8Array {
	const header = new DataView(new ArrayBuffer(44));
	const ascii = (offset: number, text: string) => {
		for (let i = 0; i < text.length; i++)
			header.setUint8(offset + i, text.charCodeAt(i));
	};
	ascii(0, "RIFF");
	header.setUint32(4, 36 + pcm.length, true);
	ascii(8, "WAVEfmt ");
	header.setUint32(16, 16, true); // fmt chunk size
	header.setUint16(20, 1, true); // PCM
	header.setUint16(22, 1, true); // mono
	header.setUint32(24, PCM_RATE, true);
	header.setUint32(28, PCM_RATE * 2, true); // byte rate
	header.setUint16(32, 2, true); // block align
	header.setUint16(34, 16, true); // bits per sample
	ascii(36, "data");
	header.setUint32(40, pcm.length, true);

	const wav = new Uint8Array(44 + pcm.length);
	wav.set(new Uint8Array(header.buffer));
	wav.set(pcm, 44);
	return wav;
}

export type NarrateInput = {
	/** The written answer, LaTeX and markdown included. Never sent to the voice. */
	answer: string;
	persona: string;
	methodCard: string | null;
};

export type NarrateDeps = Pick<Deps, "llm"> & { speech: SpeechModel };

// Two calls, in order: rewrite, then speak.
//
// The rewrite is not decoration. The answer on screen is LaTeX and numbered markdown, and a
// nested fraction read aloud is noise — the script is a different artefact, and it is kept
// alongside the audio so a bad clip can be blamed on the right stage.
export async function narrate(
	input: NarrateInput,
	deps: NarrateDeps,
): Promise<Narration> {
	const { text } = await generateText({
		model: deps.llm("fast"),
		instructions: [
			NARRATION_INSTRUCTIONS,
			input.persona && `صدای این معلم:\n${input.persona}`,
			input.methodCard && `روش این معلم برای این موضوع:\n${input.methodCard}`,
		]
			.filter(Boolean)
			.join("\n\n"),
		prompt: input.answer,
	});

	const script = text.trim();
	if (!script) throw new Error("narration came back empty");

	const { audio } = await generateSpeech({
		model: deps.speech,
		text: script,
		voice: env.SPEECH_VOICE,
		outputFormat: env.SPEECH_FORMAT,
	});

	const pcm = env.SPEECH_FORMAT === "pcm";
	return {
		script,
		audio: pcm ? toWav(audio.uint8Array) : audio.uint8Array,
		extension: pcm ? "wav" : "mp3",
		hash: createHash("sha256").update(script, "utf8").digest("hex"),
	};
}
