import { redirect } from "next/navigation";
import { Chat } from "@/components/chat/chat";
import { currentUserId } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";
import { listSubjects } from "@/lib/db/subjects";

export default async function NewConversationPage() {
	if (!(await currentUserId())) redirect("/login");
	// From the database, so an ingested chapter shows up without a deploy.
	const subjects = await listSubjects(prisma);
	return <Chat initialMessages={[]} subjects={subjects} />;
}
