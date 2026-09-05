// Four probes against the real AvalAI account. Each one changes the architecture
// if it fails, so they run before any application code depends on them.
//
// Deliberately raw fetch rather than lib/ai/provider.ts: these test the gateway's
// transport behaviour (SSE framing, image passthrough, response_format), which the
// AI SDK abstracts away. This is the one file allowed to name a model endpoint.

const BASE = process.env.AI_BASE_URL?.replace(/\/$/, "");
const KEY = process.env.AI_API_KEY;
if (!BASE || !KEY) {
	console.error(
		"Set AI_BASE_URL and AI_API_KEY in .env first (see .env.example).",
	);
	process.exit(1);
}

const REASONING = process.env.MODEL_REASONING ?? "gemini-2.5-flash";
const FAST = process.env.MODEL_FAST ?? REASONING;
const EMBEDDING = process.env.MODEL_EMBEDDING ?? "text-embedding-004";
const REQUESTED_DIM = Number(process.env.EMBEDDING_DIM ?? 768);

// 512x512, four solid quadrants: red, green, blue, white. Encoded by a real PNG
// encoder — a hand-rolled one produced a stream Google rejected outright, which
// looks exactly like the gateway stripping the image. Four regions, not one, so a
// model that guesses "red" from the prompt alone cannot pass.
const PROBE_IMAGE = (
	await Bun.file(new URL("fixtures/probe-image.png", import.meta.url)).bytes()
).toBase64();

const post = (path: string, body: unknown) =>
	fetch(`${BASE}${path}`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			authorization: `Bearer ${KEY}`,
		},
		body: JSON.stringify(body),
	});

type Probe = { name: string; ok: boolean; detail: string };
const results: Probe[] = [];
const record = (name: string, ok: boolean, detail: string) => {
	results.push({ name, ok, detail });
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}\n      ${detail}\n`);
};

// 0 — which model ids actually exist here. Resellers lag upstream.
async function probeModels() {
	const res = await fetch(`${BASE}/models`, {
		headers: { authorization: `Bearer ${KEY}` },
	});
	if (!res.ok)
		return record("0 model list", false, `${res.status} ${await res.text()}`);
	const json = (await res.json()) as { data?: { id: string }[] };
	const ids = (json.data ?? []).map((m) => m.id);
	const embed = ids.filter((id) => /embed/i.test(id));
	await Bun.write("scripts/.models.json", JSON.stringify(ids, null, 2));
	record(
		"0 model list",
		ids.length > 0,
		`${ids.length} models. embedding candidates: ${embed.join(", ") || "none"}. full list -> scripts/.models.json`,
	);
}

// 1 — does base64 image input proxy through, or does the gateway silently drop it.
async function probeVision() {
	const res = await post("/chat/completions", {
		model: REASONING,
		messages: [
			{
				role: "user",
				content: [
					{
						type: "text",
						text: "Name the colour of each quadrant of this image: top-left, top-right, bottom-left, bottom-right. Four words only.",
					},
					{
						type: "image_url",
						image_url: { url: `data:image/png;base64,${PROBE_IMAGE}` },
					},
				],
			},
		],
	});
	const text = await res.text();
	if (!res.ok)
		return record(
			"1 vision (base64 passthrough)",
			false,
			`${res.status} ${text.slice(0, 300)}`,
		);
	const answer =
		(JSON.parse(text) as { choices: { message: { content: string } }[] })
			.choices[0]?.message.content ?? "";
	const quadrants = ["red", "green", "blue", "white"];
	const seen = quadrants.filter((c) => new RegExp(c, "i").test(answer));
	record(
		"1 vision (base64 passthrough)",
		seen.length === 4,
		`model read ${seen.length}/4 quadrants: ${JSON.stringify(answer.trim())}`,
	);
}

// 2 — does streaming arrive as SSE, and how long until the first token.
async function probeStreaming() {
	const started = performance.now();
	const res = await post("/chat/completions", {
		model: REASONING,
		stream: true,
		messages: [{ role: "user", content: "به فارسی تا پنج بشمار." }],
	});
	if (!res.ok || !res.body)
		return record(
			"2 streaming (SSE + TTFT)",
			false,
			`${res.status} ${await res.text()}`,
		);

	const contentType = res.headers.get("content-type") ?? "";
	let ttft = 0;
	let chunks = 0;
	let sawDone = false;
	let buffer = "";
	for await (const bytes of res.body as unknown as AsyncIterable<Uint8Array>) {
		buffer += new TextDecoder().decode(bytes);
		for (const line of buffer.split("\n")) {
			if (!line.startsWith("data: ")) continue;
			const payload = line.slice(6).trim();
			if (payload === "[DONE]") sawDone = true;
			else if (payload) {
				if (!ttft) ttft = performance.now() - started;
				chunks++;
			}
		}
		buffer = buffer.slice(buffer.lastIndexOf("\n") + 1);
	}
	const isSse = contentType.includes("event-stream");
	record(
		"2 streaming (SSE + TTFT)",
		isSse && chunks > 1 && ttft > 0,
		`content-type=${contentType} ttft=${Math.round(ttft)}ms chunks=${chunks} [DONE]=${sawDone}`,
	);
}

// 3 — is response_format honoured, or does the gateway ignore/reject it.
// The architecture assumes NO. A pass here is a bonus, never a dependency.
async function probeResponseFormat() {
	const res = await post("/chat/completions", {
		model: FAST,
		response_format: { type: "json_object" },
		messages: [
			{ role: "user", content: 'Return {"ok":true} and nothing else.' },
		],
	});
	const text = await res.text();
	if (!res.ok)
		return record(
			"3 response_format",
			false,
			`rejected: ${res.status} ${text.slice(0, 300)}`,
		);
	const content =
		(JSON.parse(text) as { choices: { message: { content: string } }[] })
			.choices[0]?.message.content ?? "";
	let parsed = false;
	try {
		JSON.parse(content);
		parsed = true;
	} catch {}
	record(
		"3 response_format",
		parsed,
		`accepted, output ${parsed ? "parsed as JSON" : "was not JSON"}: ${JSON.stringify(content.slice(0, 120))}`,
	);
}

// 4 — which embedding model works and what dimension does it return. We ask for
// EMBEDDING_DIM explicitly: a gateway that silently ignores `dimensions` and returns
// a different width would otherwise only surface as a failed insert at ingest time.
async function probeEmbedding() {
	const res = await post("/embeddings", {
		model: EMBEDDING,
		input: "مشتق تابع نمایی",
		dimensions: REQUESTED_DIM,
	});
	const text = await res.text();
	if (!res.ok)
		return record(
			"4 embeddings",
			false,
			`${EMBEDDING}: ${res.status} ${text.slice(0, 300)}`,
		);
	const dim =
		(JSON.parse(text) as { data: { embedding: number[] }[] }).data[0]?.embedding
			.length ?? 0;
	record(
		"4 embeddings",
		dim === REQUESTED_DIM,
		`${EMBEDDING}: asked for dimensions=${REQUESTED_DIM}, got ${dim}.${dim === REQUESTED_DIM ? "" : ` EMBEDDING_DIM must be ${dim}, and schema.prisma's vector() must match.`}`,
	);
}

for (const probe of [
	probeModels,
	probeVision,
	probeStreaming,
	probeResponseFormat,
	probeEmbedding,
]) {
	try {
		await probe();
	} catch (error) {
		record(probe.name, false, String(error));
	}
}

const failed = results.filter((r) => !r.ok);
console.log(
	`${results.length - failed.length}/${results.length} probes passed.`,
);
process.exit(failed.length ? 1 : 0);

export {};
