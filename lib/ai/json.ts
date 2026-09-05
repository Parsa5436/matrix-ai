import { generateText } from "ai";
import type { ZodType } from "zod";
import { z } from "zod";
import type { Deps } from "@/lib/answer/types";
import type { ChatRole } from "./models";

// Resellers may not proxy response_format, and a gateway that accepts and ignores it
// fails as confident prose instead of an error. So: ask for JSON, strip fences anyway,
// validate with Zod, retry once with the validation error appended, then give up.

export class JsonExtractionError extends Error {
	constructor(
		message: string,
		readonly raw: string,
	) {
		super(message);
		this.name = "JsonExtractionError";
	}
}

const stripFences = (text: string) =>
	text
		.trim()
		.replace(/^```(?:json)?\s*/i, "")
		.replace(/\s*```$/, "")
		.trim();

export async function generateJson<T>(
	// only the model is needed here; taking the whole Deps would force every caller to
	// build a database client it never uses.
	deps: Pick<Deps, "llm">,
	options: {
		role: ChatRole;
		instructions: string;
		prompt: string;
		schema: ZodType<T>;
		/** Optional page or photo to read the JSON off. */
		image?: { data: Uint8Array; mediaType: string };
	},
): Promise<T> {
	let prompt = options.prompt;
	let lastRaw = "";

	for (let attempt = 0; attempt < 2; attempt++) {
		const { image } = options;
		const { text } = await generateText({
			model: deps.llm(options.role),
			instructions: options.instructions,
			// `{ type: "image" }` is the deprecated part shape in this SDK version; a file part
			// carrying an explicit mediaType is the current one.
			...(image
				? {
						messages: [
							{
								role: "user" as const,
								content: [
									{ type: "text" as const, text: prompt },
									{
										type: "file" as const,
										data: image.data,
										mediaType: image.mediaType,
									},
								],
							},
						],
					}
				: { prompt }),
		});
		lastRaw = text;

		let candidate: unknown;
		try {
			candidate = JSON.parse(stripFences(text));
		} catch {
			prompt = `${options.prompt}\n\nYour previous reply was not valid JSON. Reply with JSON only, no prose and no markdown fences.`;
			continue;
		}

		const parsed = options.schema.safeParse(candidate);
		if (parsed.success) return parsed.data;

		prompt = `${options.prompt}\n\nYour previous reply failed validation:\n${z.prettifyError(parsed.error)}\nReply with corrected JSON only.`;
	}

	throw new JsonExtractionError(
		"model did not return schema-valid JSON after a retry",
		lastRaw,
	);
}
