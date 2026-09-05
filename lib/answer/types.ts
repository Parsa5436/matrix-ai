import type { LanguageModel } from "ai";
import type { ChatRole } from "@/lib/ai/models";
import type { PrismaClient } from "@/lib/db/generated/client";

export type AnswerInput = {
	question: string;
	imageUrl?: string;
	subjectId: string;
	chapterId?: string;
	history: { role: "user" | "assistant"; text: string }[];
};

export type AnswerMode = "teacher" | "standard" | "general";

export type SourceRef = {
	kind: "note" | "book" | "exemplar" | "method-card";
	id: string;
	label: string;
};

/**
 * A stage the pipeline actually ran, reported as it happens. `detail` is Persian and is only
 * ever set from something that really occurred — a stage with nothing true to say sends
 * none, and the UI then renders none.
 */
export type AnswerStage = {
	name: "condense" | "classify" | "retrieve" | "generate";
	detail?: string;
};

export type AnswerChunk =
	| { type: "stage"; stage: AnswerStage }
	| { type: "mode"; mode: AnswerMode }
	| { type: "text"; delta: string }
	| { type: "sources"; sources: SourceRef[] };

export type LoadedImage = { data: Uint8Array; mediaType: string };

// Injected rather than imported so the eval harness runs the pipeline against fakes, and
// so swapping the reseller never reaches into a pipeline stage.
//
// `loadImage` is here rather than as bytes on AnswerInput for the same reason: the pipeline
// must stay HTTP-free, and AnswerInput is persisted and logged — a few megabytes of base64
// does not belong in it. The route resolves an id from storage; the eval rasterises a slide.
export type Deps = {
	llm: (role: ChatRole) => LanguageModel;
	embed: (text: string) => Promise<number[]>;
	db: PrismaClient;
	loadImage?: (imageUrl: string) => Promise<LoadedImage | null>;
};
