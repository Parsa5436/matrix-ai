import type { PrismaClient } from "@/lib/db/generated/client";

// The only way to read a method card. `teacherApproved` is not a hint: an unapproved card
// is a draft the fast model wrote from the notes, and putting one in a prompt would mean
// telling a student that a machine's guess is their teacher's method. There is no
// approval UI on purpose — this filter and the flag are the whole mechanism.
//
// Takes the whole topic group rather than one topic, because a canonical topic is spread
// over many ingest topic rows and the card is filed against one of them. `orderBy` is not
// cosmetic: without it, two approved cards in one group would each be returned on different
// requests, and the same question would be answered two different ways with nothing in the
// logs to explain it.
export async function getApprovedMethodCard(
	prisma: PrismaClient,
	topicIds: string[],
	corpusVersion: number,
): Promise<string | null> {
	if (topicIds.length === 0) return null;
	const card = await prisma.methodCard.findFirst({
		where: { topicId: { in: topicIds }, corpusVersion, teacherApproved: true },
		orderBy: { topicId: "asc" },
		select: { contentMd: true },
	});
	return card?.contentMd ?? null;
}
