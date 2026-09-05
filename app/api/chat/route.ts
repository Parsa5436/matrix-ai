import {
	createUIMessageStream,
	createUIMessageStreamResponse,
	safeValidateUIMessages,
	toUIMessageStream,
	type UIMessage,
	type UIMessageStreamWriter,
} from "ai";
import { z } from "zod";
import { embedQuery } from "@/lib/ai/embed";
import { meteredModel, QuotaExceededError } from "@/lib/ai/metering";
import type { ChatRole } from "@/lib/ai/models";
import { languageModel } from "@/lib/ai/provider";
import { streamGeneralAnswer } from "@/lib/answer/general";
import { answer } from "@/lib/answer/pipeline";
import type { AnswerChunk, AnswerMode, AnswerStage } from "@/lib/answer/types";
import { currentUserId } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";
import {
	appendMessage,
	createConversation,
	getConversation,
	type StoredPart,
	textOf,
} from "@/lib/db/conversations";
import { conversationUsage } from "@/lib/db/usage";
import { env } from "@/lib/env";
import { refuse } from "@/lib/http";
import { getStored, imageIdFromPath } from "@/lib/storage";

export const runtime = "nodejs"; // pg and long-lived streams do not work on Edge.
export const maxDuration = 60;

// The data parts this route writes on the way out, and therefore receives back inside the
// assistant message on every following turn. A schema that only allowed text parts accepted
// the first request and rejected the second — the SDK's own docs are explicit that messages
// carrying data parts must be validated with validateUIMessages, and that anything without
// a schema here is assumed valid rather than rejected.
const DATA_SCHEMAS = {
	mode: z.object({ mode: z.enum(["teacher", "standard", "general"]) }),
	sources: z.object({
		sources: z.array(
			z.object({
				kind: z.enum(["note", "book", "exemplar", "method-card"]),
				id: z.string(),
				label: z.string(),
			}),
		),
	}),
	stages: z.object({
		stages: z.array(
			z.object({
				name: z.enum(["condense", "classify", "retrieve", "generate"]),
				detail: z.string().optional(),
			}),
		),
	}),
	conversation: z.object({ id: z.string() }),
	message: z.object({ id: z.string() }),
};

const BodySchema = z.object({
	// Shape-checked by safeValidateUIMessages below, which takes `unknown` and hands back
	// typed UIMessages — so the parts are validated without a cast on either side.
	messages: z.array(z.unknown()).min(1).max(100),
	// Optional, and its absence is meaningful: with no subject there is nothing safe to
	// retrieve — an unfiltered vector search is the confidently-wrong failure the subject
	// filter exists to prevent — so the request degrades to general chat instead.
	subjectId: z.string().min(1).optional(),
	// Absent on the first message of a conversation; the reply carries the new id back.
	conversationId: z.string().min(1).optional(),
});

/** The uploaded photo on a message, if it carries one. */
const imageUrlOf = (message: UIMessage | undefined) =>
	message?.parts.find((part) => part.type === "file")?.url;

// Resolves one of our own /api/files paths to bytes. Injected rather than fetched inside the
// pipeline, which has to stay HTTP-free.
const loadImage = async (imageUrl: string) => {
	const id = imageIdFromPath(imageUrl);
	return id ? await getStored(id) : null;
};

// Quota is refused by the model wrapper, so it arrives here as a thrown error rather than as
// a branch this route could forget to take.
const persianError = (error: unknown) =>
	error instanceof QuotaExceededError
		? "سهم امروزت تمام شده است. فردا دوباره سر بزن."
		: "ارتباط با سرویس هوش مصنوعی برقرار نشد. چند لحظه بعد دوباره تلاش کنید.";

/**
 * Copies the pipeline's chunks onto the UI stream, and returns the assistant message to
 * store. The stored parts are the same ones the browser just rendered, so reloading a
 * conversation shows the badge and citations rather than a bare paragraph.
 */
async function forwardToClient(
	writer: UIMessageStreamWriter,
	chunks: AsyncIterable<AnswerChunk>,
): Promise<{ parts: StoredPart[]; mode: AnswerMode | null }> {
	const id = crypto.randomUUID();
	// Slot 0 is reserved for the stage list so it stays above the answer on reload.
	const parts: StoredPart[] = [{ type: "data-stages", data: { stages: [] } }];
	const stages: AnswerStage[] = [];
	let mode: AnswerMode | null = null;
	let text = "";
	// Tracked separately from `text`: an empty first delta would otherwise open the text
	// block twice.
	let opened = false;

	for await (const chunk of chunks) {
		if (chunk.type === "stage") {
			// Accumulated on one part rather than streamed as many: the UI wants the list of
			// stages, and a reload should show the same list the browser saw live.
			stages.push(chunk.stage);
			parts[0] = { type: "data-stages", data: { stages } };
			writer.write({ type: "data-stages", data: { stages } });
			continue;
		}
		if (chunk.type === "mode") {
			mode = chunk.mode;
			parts.push({ type: "data-mode", data: { mode } });
			writer.write({ type: "data-mode", data: { mode } });
			continue;
		}
		if (chunk.type === "text") {
			if (!opened) {
				writer.write({ type: "text-start", id });
				opened = true;
			}
			text += chunk.delta;
			writer.write({ type: "text-delta", id, delta: chunk.delta });
			continue;
		}
		if (chunk.type === "sources") {
			if (opened) writer.write({ type: "text-end", id });
			parts.push({ type: "text", text });
			parts.push({ type: "data-sources", data: { sources: chunk.sources } });
			writer.write({ type: "data-sources", data: { sources: chunk.sources } });
			return { parts, mode };
		}
	}

	// Reached only if the pipeline ends without emitting sources.
	if (opened) {
		writer.write({ type: "text-end", id });
		parts.push({ type: "text", text });
	}
	return { parts, mode };
}

export async function POST(req: Request) {
	const userId = await currentUserId();
	if (!userId) return refuse("برای ادامه وارد حساب خود شوید.", 401);

	const body = BodySchema.safeParse(await req.json().catch(() => null));
	if (!body.success) {
		// The validation detail is English and describes our internals, so it goes to the log
		// and the student gets the Persian sentence.
		console.error("[chat] rejected body", z.prettifyError(body.error));
		return refuse(
			"درخواست نامعتبر بود. صفحه را تازه کن و دوباره تلاش کن.",
			400,
		);
	}

	const { subjectId, conversationId } = body.data;

	// Parts, metadata and data parts are checked here rather than in BodySchema: this is the
	// SDK's own validator, so it stays correct as the part union grows.
	const validated = await safeValidateUIMessages({
		messages: body.data.messages,
		dataSchemas: DATA_SCHEMAS,
	});
	if (!validated.success) {
		console.error("[chat] rejected messages", validated.error.message);
		return refuse(
			"درخواست نامعتبر بود. صفحه را تازه کن و دوباره تلاش کن.",
			400,
		);
	}
	const messages = validated.data;

	// Bound to this user here because this is the only layer that knows who they are. Scripts
	// and the eval pass the raw provider and are deliberately unmetered.
	const llm = (role: ChatRole, conversationId?: string) =>
		meteredModel(languageModel(role), {
			db: prisma,
			userId,
			role,
			...(conversationId ? { conversationId } : {}),
		});

	if (!subjectId) {
		const result = await streamGeneralAnswer(messages, { llm });
		return createUIMessageStreamResponse({
			stream: toUIMessageStream({
				stream: result.stream,
				// Defaults to true. The reasoning model thinks in English, and forwarding that
				// puts a paragraph of English above every Persian answer.
				sendReasoning: false,
				onError: (error) => {
					console.error("[chat] upstream failed", error);
					return persianError(error);
				},
			}),
		});
	}

	const last = messages.at(-1);
	const question = last ? textOf(last.parts) : "";
	const imageUrl = imageUrlOf(last);
	const history = messages
		.slice(0, -1)
		.flatMap((m) =>
			m.role === "system" ? [] : [{ role: m.role, text: textOf(m.parts) }],
		);

	// A conversation id arrives from the browser and is guessable, so it is only ever used
	// after getConversation has confirmed this user owns it.
	const existing = conversationId
		? await getConversation(prisma, conversationId, userId)
		: null;
	// Checked before the message is stored, so a refused turn does not grow the transcript it
	// was refused for.
	//
	// contextTokens is the last call's prompt plus its completion — i.e. everything that will
	// be replayed on this one, short of the new message. It is an approximation, and it is the
	// honest one available: the SDK exposes no pre-flight count, and no tokeniser we could
	// install agrees with Gemini's on Persian. It is a floor rather than a guess, so the
	// refusal always lands before the provider's own window does.
	if (existing) {
		const { contextTokens } = await conversationUsage(prisma, existing.id);
		if (contextTokens >= env.CONTEXT_LIMIT_TOKENS) {
			return refuse(
				"این گفتگو دیگر جا ندارد. یک گفتگوی تازه شروع کن — سؤال بعدی‌ات را آنجا بپرس.",
				413,
			);
		}
	}

	const conversation =
		existing ??
		(await createConversation(prisma, {
			userId,
			subjectId,
			firstMessage: question,
		}));

	await appendMessage(prisma, {
		conversationId: conversation.id,
		userId,
		role: "user",
		// The photo is stored on the message too, so reloading a conversation shows what the
		// student actually sent rather than a bare sentence.
		parts: [
			...(imageUrl
				? [{ type: "file", url: imageUrl, mediaType: "image/webp" }]
				: []),
			{ type: "text", text: question },
		],
	});

	// This handler adapts HTTP to the pipeline and does nothing else — no retrieval, no
	// prompt, no model call.
	const stream = createUIMessageStream({
		execute: async ({ writer }) => {
			if (!existing) {
				writer.write({
					type: "data-conversation",
					data: { id: conversation.id },
				});
			}

			const { parts, mode } = await forwardToClient(
				writer,
				answer(
					{ question, subjectId, history, ...(imageUrl ? { imageUrl } : {}) },
					{
						// Bound to the conversation here so every call it makes is attributed
						// to it — the context readout is built from these rows.
						llm: (role) => llm(role, conversation.id),
						embed: embedQuery,
						db: prisma,
						loadImage,
					},
				),
			);

			const stored = await appendMessage(prisma, {
				conversationId: conversation.id,
				userId,
				role: "assistant",
				parts,
				mode,
			});

			// The row id, not the one useChat made up client-side. /api/speech is addressed by
			// it, and on a later visit the same id arrives as the UIMessage's own id.
			if (stored) {
				writer.write({ type: "data-message", data: { id: stored.id } });
			}
		},
		onError: (error) => {
			console.error("[chat] pipeline failed", error);
			return persianError(error);
		},
	});

	return createUIMessageStreamResponse({ stream });
}
