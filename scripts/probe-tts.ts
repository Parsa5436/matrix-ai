// Does the gateway carry a speech model, and does it read Persian physics correctly?
//
// Neither question is answerable from documentation. xAI's own docs do not list Persian among
// the TTS languages and it speaks it fine; AvalAI's docs list Gemini and ElevenLabs voices and
// no xAI at all. So this generates real audio and transcribes it back — a round trip settles
// what listening cannot argue about, and it is the check to re-run on any gateway change.
//
// Raw fetch on purpose, like probe.ts: this tests the gateway's transport, not our provider.

const BASE = process.env.AI_BASE_URL?.replace(/\/$/, "");
const KEY = process.env.AI_API_KEY;
if (!BASE || !KEY) {
	console.error("Set AI_BASE_URL and AI_API_KEY in .env first.");
	process.exit(1);
}

const MODEL = process.env.MODEL_SPEECH ?? "x-ai/grok-voice-tts-1.0";
const VOICE = process.env.SPEECH_VOICE ?? "ara";
// Whatever the gateway offers that accepts audio input. Only used to grade the output.
const EARS = process.env.PROBE_TTS_EARS ?? "google/gemini-3.5-flash";

const headers = {
	authorization: `Bearer ${KEY}`,
	"content-type": "application/json",
};

// The cases that decide whether a physics narration survives. Digits are the known failure
// mode: «۱۳/۶ گرم بر سانتی‌متر مکعب» has been observed coming back as «شانزده», which is why
// NARRATION_INSTRUCTIONS forbids them.
const CASES: Record<string, string> = {
	"digits (must fail)": "چگالی برابر ۱۳/۶ گرم بر سانتی‌متر مکعب است.",
	decimal: "چگالی برابر سیزده ممیز شش است.",
	unit: "سیزده ممیز شش گرم بر سانتی‌متر مکعب",
	exponent: "حجم برابر دویست و پنجاه سانتی‌متر به توان سه است.",
	scientific: "سه ممیز چهار ضرب در ده به توان منفی سه کیلوگرم",
	fraction: "چگالی برابر است با جرم تقسیم بر حجم.",
	latin: "یکای SI برای جرم، کیلوگرم است.",
};

async function speak(text: string) {
	const res = await fetch(`${BASE}/audio/speech`, {
		method: "POST",
		headers,
		body: JSON.stringify({
			model: MODEL,
			input: text,
			voice: VOICE,
			response_format: "mp3",
		}),
	});
	// A non-2xx comes back as JSON, not audio.
	if (!res.ok)
		throw new Error(`${res.status} ${(await res.text()).slice(0, 300)}`);
	return new Uint8Array(await res.arrayBuffer());
}

async function transcribe(audio: Uint8Array) {
	const res = await fetch(`${BASE}/chat/completions`, {
		method: "POST",
		headers,
		body: JSON.stringify({
			model: EARS,
			messages: [
				{
					role: "user",
					content: [
						{
							type: "text",
							text: "Transcribe this audio exactly as spoken, writing numbers as the words you hear. Transcript only.",
						},
						{
							type: "input_audio",
							input_audio: { data: audio.toBase64(), format: "mp3" },
						},
					],
				},
			],
		}),
	});
	const json = (await res.json()) as {
		choices?: { message?: { content?: string } }[];
	};
	return json.choices?.[0]?.message?.content?.trim() ?? "(nothing)";
}

console.log(`${BASE}\n${MODEL} / ${VOICE}\n`);
let failed = false;
for (const [label, text] of Object.entries(CASES)) {
	try {
		const audio = await speak(text);
		await Bun.write(`scripts/.tts-${label.replace(/\W+/g, "-")}.mp3`, audio);
		console.log(
			`${label}\n  sent: ${text}\n  back: ${await transcribe(audio)}\n`,
		);
	} catch (error) {
		failed = true;
		console.log(`${label}\n  FAILED ${(error as Error).message}\n`);
	}
}
console.log(
	failed
		? "The gateway did not serve this speech model. Check MODEL_SPEECH against its model list."
		: "Audio written to scripts/.tts-*.mp3 — listen before trusting the transcripts.",
);

export {};
