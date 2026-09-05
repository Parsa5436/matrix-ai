import { z } from "zod";

// Every structured model output lives here, so the contracts we hold models to are
// auditable in one place rather than scattered through the callers.

export const ExtractedExemplarSchema = z.object({
	question: z.string().min(5),
	options: z.array(z.string()).nullable().default(null),
	answer: z.string().min(1),
	solutionMd: z.string().min(5),
	methodTags: z.array(z.string()).max(6).default([]),
	difficulty: z.number().int().min(1).max(5).nullable().default(null),
});

// Raw SQL is untyped; this is the boundary where vector hits become trustworthy.
export const VectorHitSchema = z.object({
	id: z.string().min(1),
	score: z.number(),
});

// One teaching slide, as read off the page. The split between what was printed and what the
// teacher wrote is the whole point: `handwriting` and `methodSteps` are the method signal,
// and they are also what the ink oracle independently verifies should exist.
const SlideKindSchema = z.enum(["تست", "مثال", "نکته", "درسنامه", "other"]);

export const ExtractedSlideSchema = z.object({
	slideKind: SlideKindSchema,
	topicTitle: z.string().min(2).max(80),
	printedText: z.string().default(""),
	question: z.string().nullable().default(null),
	options: z.array(z.string()).nullable().default(null),
	handwriting: z.string().default(""),
	markedAnswer: z.string().nullable().default(null),
	methodSteps: z.array(z.string()).default([]),
});

export type ExtractedSlide = z.infer<typeof ExtractedSlideSchema>;

// Routing only: whether the question is coursework, and which topic it belongs to.
export const ClassificationSchema = z.object({
	kind: z.enum(["general", "educational"]),
	topic: z.string().nullable().default(null),
	confidence: z.number().min(0).max(1).default(0),
});

// A merged method card, audited back against the teacher's own slides. The drafting
// instructions forbid adding textbook advice he never gave, but an instruction is not an
// enforcement: approving a card puts it verbatim into every answer on that topic, under his
// name. This is the check that a claim traces back to something he actually wrote.
export const CardGroundingSchema = z.object({
	unsupported: z
		.array(
			z.object({
				claim: z.string().min(1),
				why: z.string().min(1),
			}),
		)
		.default([]),
});

// A photographed question, read off the image. `figure` is the part that earns its place:
// the model describes what it sees so retrieval has words to search with, but the original
// image still goes into the final call — see assemble().
export const PhotographedQuestionSchema = z.object({
	question: z.string().min(3),
	options: z.array(z.string()).nullable().default(null),
	figure: z.string().nullable().default(null),
	readable: z.boolean().default(true),
});
