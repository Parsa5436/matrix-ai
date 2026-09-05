// Proves the property the eval harness depends on: the answer pipeline runs from a
// plain script, with a fake model, over no HTTP and no provider. If someone imports
// lib/ai/provider inside lib/answer/, this fails on the missing environment instead of
// quietly reaching AvalAI.

import { simulateReadableStream, type UIMessage } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { streamGeneralAnswer } from "@/lib/answer/general";

const llm = () =>
	new MockLanguageModelV4({
		doStream: async () => ({
			stream: simulateReadableStream({
				chunks: [
					{ type: "text-start", id: "t" },
					{ type: "text-delta", id: "t", delta: "سلام" },
					{ type: "text-delta", id: "t", delta: "، بپرس." },
					{ type: "text-end", id: "t" },
				],
			}),
		}),
	});

const messages: UIMessage[] = [
	{ id: "1", role: "user", parts: [{ type: "text", text: "سلام" }] },
];

const result = await streamGeneralAnswer(messages, { llm });

let text = "";
for await (const delta of result.textStream) {
	text += delta;
}

if (text !== "سلام، بپرس.") {
	console.error(
		`answer seam broken: expected the fake model's text, got ${JSON.stringify(text)}`,
	);
	process.exit(1);
}

console.log(
	"answer seam ok — pipeline ran against a fake llm, no provider, no HTTP",
);
