import { generateText, type ModelMessage, streamText } from "ai";
import { generateJson, JsonExtractionError } from "@/lib/ai/json";
import {
	CONDENSE_QUESTION_INSTRUCTIONS,
	EXTRACT_PHOTO_INSTRUCTIONS,
	GENERAL_SYSTEM_PROMPT,
} from "@/lib/ai/prompts";
import { PhotographedQuestionSchema } from "@/lib/ai/schemas";
import { toPersianDigits } from "@/lib/persian";
import { assemble } from "./assemble";
import { classify } from "./classify";
import { retrieve } from "./retrieve";
import type {
	AnswerChunk,
	AnswerInput,
	AnswerMode,
	Deps,
	LoadedImage,
	SourceRef,
} from "./types";

export type AnswerOptions = {
	/** Eval only: never retrieve the exemplar a question was built from. */
	excludeExemplarIds?: string[];
};

type Plan = {
	instructions: string;
	messages: ModelMessage[];
	mode: AnswerMode;
	sources: SourceRef[];
};

const asModelMessages = (history: AnswerInput["history"]): ModelMessage[] =>
	history.map((turn) => ({ role: turn.role, content: turn.text }));

/**
 * Reads a photographed question into text, so classification and retrieval have words to
 * work with. The image is returned alongside and goes on to the final call — this pass is
 * an aid, never a replacement for it.
 */
async function readPhoto(
	input: AnswerInput,
	deps: Deps,
): Promise<{ question: string; image: LoadedImage | null }> {
	if (!input.imageUrl || !deps.loadImage)
		return { question: input.question, image: null };

	const image = await deps.loadImage(input.imageUrl);
	if (!image) return { question: input.question, image: null };

	const typed = input.question.trim();
	try {
		const read = await generateJson(deps, {
			role: "reasoning",
			instructions: EXTRACT_PHOTO_INSTRUCTIONS,
			prompt: typed || "این سؤال را بخوان.",
			schema: PhotographedQuestionSchema,
			image,
		});

		const options = read.options?.length
			? `گزینه‌ها:\n${read.options.map((o, i) => `${i + 1}) ${o}`).join("\n")}`
			: null;
		const parts = [
			read.question,
			options,
			read.figure ? `توضیح شکل: ${read.figure}` : null,
			typed || null,
		].filter(Boolean);

		return { question: parts.join("\n\n"), image };
	} catch (error) {
		if (!(error instanceof JsonExtractionError)) throw error;
		console.error("[answer] could not read the photograph", error.message);
		return { question: typed, image };
	}
}

/**
 * Rewrites a follow-up into a standalone question, for retrieval only.
 *
 * The model gets the whole conversation, so it needs no help remembering. The vector search
 * does: «حالا اگر جرم دو برابر شود؟» carries no physics nouns, so it embeds near nothing and
 * the teacher's own examples silently stop arriving. This is the standard fix in
 * conversational RAG — decontextualise the last turn before searching on it.
 *
 * Retrieval-only on purpose: the rewrite never reaches the prompt, so a bad rewrite costs
 * search quality and cannot put words in the student's mouth.
 */
async function condense(
	question: string,
	history: AnswerInput["history"],
	deps: Deps,
): Promise<string> {
	if (history.length === 0) return question;

	const transcript = history
		.map(
			(turn) => `${turn.role === "user" ? "دانش‌آموز" : "استاد"}: ${turn.text}`,
		)
		.join("\n");

	try {
		const { text } = await generateText({
			model: deps.llm("fast"),
			instructions: CONDENSE_QUESTION_INSTRUCTIONS,
			prompt: `گفتگو تا اینجا:\n${transcript}\n\nآخرین پیام دانش‌آموز:\n${question}`,
			temperature: 0,
		});
		const rewritten = text.trim();
		// A rewrite that came back empty, or as an essay, is a failed rewrite. Searching the
		// raw question is worse than searching a good rewrite and better than searching prose.
		return rewritten && rewritten.length <= 400 ? rewritten : question;
	} catch (error) {
		console.error(
			"[answer] condense failed, searching the raw question",
			error,
		);
		return question;
	}
}

/**
 * Runs the stages and reports each one as it completes, returning the assembled prompt.
 * A generator so the caller can stream progress without the stages knowing about HTTP.
 */
async function* planAnswer(
	input: AnswerInput,
	deps: Deps,
	options: AnswerOptions,
): AsyncGenerator<AnswerChunk, Plan> {
	const { question, image } = await readPhoto(input, deps);
	const asked: AnswerInput = { ...input, question };

	// What the search runs on. The prompt always gets `asked`, never this.
	const searchQuery = await condense(question, input.history, deps);
	if (searchQuery !== question) {
		yield { type: "stage", stage: { name: "condense", detail: searchQuery } };
	}

	const classification = await classify(searchQuery, deps);
	yield {
		type: "stage",
		stage: {
			name: "classify",
			detail: classification.topic ?? "موضوع مشخصی تشخیص داده نشد",
		},
	};

	if (classification.kind === "general") {
		return {
			instructions: GENERAL_SYSTEM_PROMPT,
			messages: [
				...asModelMessages(input.history),
				{ role: "user", content: asked.question },
			],
			mode: "general",
			sources: [],
		};
	}

	const retrieved = await retrieve(
		{ ...asked, question: searchQuery },
		classification,
		deps,
		options,
	);
	yield {
		type: "stage",
		stage: {
			name: "retrieve",
			detail: [
				retrieved.exemplars.length > 0
					? `${toPersianDigits(String(retrieved.exemplars.length))} نمونه از حل‌های استاد`
					: "نمونه‌ای پیدا نشد",
				retrieved.methodCard ? "کارت روش" : null,
				retrieved.widened ? "جستجو در کل درس" : null,
			]
				.filter(Boolean)
				.join(" · "),
		},
	};

	const teacher = await deps.db.teacher.findFirst({
		where: { chapters: { some: { subjectId: asked.subjectId } } },
		select: { personaPrompt: true },
	});

	return {
		...assemble(asked, retrieved, teacher?.personaPrompt ?? "", image),
		sources: retrieved.sources,
	};
}

// read photo -> condense -> classify -> retrieve -> assemble -> generate -> stream.
//
// Stages are reported as they run, so the UI shows what actually happened rather than an
// animation. mode is emitted before any text so the badge is settled before the answer
// arrives; sources come last, once the answer is committed to.
export async function* answer(
	input: AnswerInput,
	deps: Deps,
	options: AnswerOptions = {},
): AsyncIterable<AnswerChunk> {
	const { instructions, messages, mode, sources } = yield* planAnswer(
		input,
		deps,
		options,
	);

	yield { type: "stage", stage: { name: "generate" } };
	yield { type: "mode", mode };

	const result = streamText({
		model: deps.llm("reasoning"),
		instructions,
		messages,
	});
	for await (const delta of result.textStream) yield { type: "text", delta };

	yield { type: "sources", sources };
}
