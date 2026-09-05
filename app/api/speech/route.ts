import { z } from "zod";
import {
	meteredModel,
	meteredSpeech,
	QuotaExceededError,
} from "@/lib/ai/metering";
import { languageModel, speechModel } from "@/lib/ai/provider";
import { narrate } from "@/lib/answer/narrate";
import { CANONICAL_TOPICS, titlesFor } from "@/lib/answer/topics";
import { currentUserId } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";
import { type StoredPart, textOf } from "@/lib/db/conversations";
import { refuse } from "@/lib/http";
import { getApprovedMethodCard } from "@/lib/knowledge/method-cards";
import { audioId, audioPath, putAudio } from "@/lib/storage";

export const runtime = "nodejs"; // the filesystem and pg do not exist on Edge.
export const maxDuration = 120; // two model calls, the second one synthesising a minute of speech.

const BodySchema = z.object({ messageId: z.string().min(1) });

/**
 * The method card this answer was actually built on, found through the citation it stored.
 * A source of kind "method-card" carries the canonical topic as its id, which is the same
 * key retrieval used — so the narration is grounded in the card the answer used, not in a
 * fresh guess about the topic.
 */
async function methodCardBehind(parts: StoredPart[]) {
	const sources = parts.find((part) => part.type === "data-sources")?.data as
		| { sources?: { kind: string; id: string }[] }
		| undefined;
	const cited = sources?.sources?.find((s) => s.kind === "method-card")?.id;
	const topic = CANONICAL_TOPICS.find((t) => t === cited);
	if (!topic) return null;

	const version = await prisma.setting.findUnique({
		where: { key: "activeCorpusVersion" },
	});
	const topics = await prisma.topic.findMany({
		where: { title: { in: titlesFor(topic) } },
		select: { id: true },
	});
	return getApprovedMethodCard(
		prisma,
		topics.map((t) => t.id),
		Number(version?.value ?? 1),
	);
}

// Generate once, play forever. The cache is `audioUrl` being set: a second tap on the
// speaker never reaches a model, which is the entire reason the audio is stored at all.
export async function POST(req: Request) {
	const userId = await currentUserId();
	if (!userId) return refuse("برای شنیدن پاسخ وارد حساب خود شو.", 401);

	const body = BodySchema.safeParse(await req.json().catch(() => null));
	if (!body.success) return refuse("درخواست نامعتبر بود.", 400);

	// Filtered on the owner, so another student's message is indistinguishable from one that
	// does not exist.
	const message = await prisma.message.findFirst({
		where: {
			id: body.data.messageId,
			role: "assistant",
			conversation: { userId },
		},
		select: {
			id: true,
			parts: true,
			audioUrl: true,
			conversationId: true,
			conversation: { select: { subjectId: true } },
		},
	});
	if (!message) return refuse("این پاسخ پیدا نشد.", 404);
	if (message.audioUrl) return Response.json({ url: message.audioUrl });

	const parts = message.parts as StoredPart[];
	const answer = textOf(parts);
	if (!answer.trim()) return refuse("این پاسخ متنی برای خواندن ندارد.", 422);

	try {
		const teacher = await prisma.teacher.findFirst({
			where: {
				chapters: { some: { subjectId: message.conversation.subjectId } },
			},
			select: { personaPrompt: true },
		});

		const meter = {
			db: prisma,
			userId,
			conversationId: message.conversationId,
		};
		const { script, audio, hash, extension } = await narrate(
			{
				answer,
				persona: teacher?.personaPrompt ?? "",
				methodCard: await methodCardBehind(parts),
			},
			{
				llm: (role) => meteredModel(languageModel(role), { ...meter, role }),
				speech: meteredSpeech(speechModel(), { ...meter, role: "speech" }),
			},
		);

		const id = audioId(hash, extension);
		await putAudio(id, audio);
		const url = audioPath(id);
		await prisma.message.update({
			where: { id: message.id },
			data: { audioUrl: url, audioScript: script },
		});

		return Response.json({ url });
	} catch (error) {
		console.error("[speech] generation failed", error);
		return refuse(
			error instanceof QuotaExceededError
				? "سهم امروزت تمام شده است. فردا دوباره سر بزن."
				: "ساخت صدا انجام نشد. چند لحظه بعد دوباره تلاش کن.",
			502,
		);
	}
}
