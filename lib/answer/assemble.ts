import type { ModelMessage } from "ai";
import { NO_METHOD_NOTICE, TEACHER_SYSTEM_PROMPT } from "@/lib/ai/prompts";
import type { Retrieved } from "./retrieve";
import type { AnswerInput, AnswerMode, LoadedImage } from "./types";

export type Assembled = {
	instructions: string;
	messages: ModelMessage[];
	mode: AnswerMode;
};

// The prompt is always the same shape, so a regression is a diff rather than an archaeology
// exercise:
//   system  teacher persona
//   system  method card for the topic — only when a teacher has approved it
//   user    2-4 retrieved exemplars, as worked examples
//   user    the student's question
//
// The two system layers are returned as `instructions` rather than as system-role messages.
// This SDK version rejects system messages inside `messages`, and its escape hatch
// (allowSystemInMessages) is documented as a prompt-injection risk precisely because the
// same array carries user turns. Same layering, different transport.
export function assemble(
	input: AnswerInput,
	retrieved: Retrieved,
	persona: string,
	image?: LoadedImage | null,
): Assembled {
	const system = [`${TEACHER_SYSTEM_PROMPT}\n\n${persona}`.trim()];
	const messages: ModelMessage[] = [];

	if (retrieved.methodCard) {
		system.push(`کارت روش این معلم برای این موضوع:\n\n${retrieved.methodCard}`);
	}

	if (retrieved.exemplars.length > 0) {
		const worked = retrieved.exemplars
			.map(
				(e, i) =>
					`### نمونه ${i + 1} — ${e.topicTitle}\nصورت مسئله: ${e.question}\nحل معلم:\n${e.solutionMd}${e.answer ? `\nپاسخ ثبت‌شده: ${e.answer}` : ""}`,
			)
			.join("\n\n");
		messages.push({
			role: "user",
			content: `چند نمونه از حل‌های خود معلم، برای اینکه روشش را ببینی:\n\n${worked}`,
		});
	} else {
		system.push(NO_METHOD_NOTICE);
	}

	for (const turn of input.history) {
		messages.push({ role: turn.role, content: turn.text });
	}

	// The photograph goes in ALONGSIDE the transcribed question, never instead of it. A
	// transcription cannot carry a graph's shape, a dial's needle, or which ray is which, and
	// those are exactly the questions a student photographs. Extraction is an aid.
	messages.push(
		image
			? {
					role: "user",
					content: [
						{ type: "text", text: input.question },
						{ type: "file", mediaType: image.mediaType, data: image.data },
					],
				}
			: { role: "user", content: input.question },
	);

	// Honest by construction: "teacher" requires that something of the teacher's actually
	// reached the prompt. A teacher badge on an answer that used neither an approved card
	// nor his exemplars is worse than admitting the fallback.
	const mode: AnswerMode =
		retrieved.methodCard || retrieved.exemplars.length > 0
			? "teacher"
			: "standard";

	return { instructions: system.join("\n\n"), messages, mode };
}
