import { convertToModelMessages, streamText, type UIMessage } from "ai";
import { GENERAL_SYSTEM_PROMPT } from "@/lib/ai/prompts";
import type { Deps } from "./types";

// Where a message goes when no subject is selected, and the tail of answer()'s general
// branch. No retrieval, so it takes only the model — which is what lets the eval harness and
// the seam check exercise it without a database.
export async function streamGeneralAnswer(
	messages: UIMessage[],
	deps: Pick<Deps, "llm">,
) {
	return streamText({
		model: deps.llm("reasoning"),
		instructions: GENERAL_SYSTEM_PROMPT,
		messages: await convertToModelMessages(messages),
	});
}
