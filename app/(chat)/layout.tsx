import { PlusIcon } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ConversationList } from "@/components/chat/conversation-list";
import { HelpDialog } from "@/components/chat/help-dialog";
import { SidebarUser } from "@/components/chat/sidebar-user";
import { buttonVariants } from "@/components/ui/button";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarHeader,
	SidebarInset,
	SidebarProvider,
	SidebarRail,
	SidebarTrigger,
} from "@/components/ui/sidebar";
import { currentUserId, endSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";
import { listConversations } from "@/lib/db/conversations";

// The guard lives in the layout so every page beneath it is authenticated by construction
// rather than by each page remembering to check.
export default async function ChatLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	const userId = await currentUserId();
	if (!userId) redirect("/login");

	const [user, conversations] = await Promise.all([
		prisma.user.findUnique({
			where: { id: userId },
			select: { username: true },
		}),
		listConversations(prisma, userId),
	]);
	if (!user) redirect("/login");

	async function signOut() {
		"use server";
		await endSession();
		redirect("/login");
	}

	return (
		<SidebarProvider>
			{/* `side` is physical, not logical — the container is positioned with left-0/right-0.
			    In an RTL document the start edge is the physical right. */}
			<Sidebar collapsible="offcanvas" side="right">
				<SidebarHeader>
					<Link
						className={buttonVariants({ className: "w-full gap-2" })}
						href="/"
					>
						<PlusIcon aria-hidden="true" className="size-4" />
						گفتگوی تازه
					</Link>
				</SidebarHeader>

				<SidebarContent>
					<ConversationList conversations={conversations} now={Date.now()} />
				</SidebarContent>

				{/* Help sat in SidebarContent behind `mt-auto`, which pins it to the bottom of the
				    SCROLLING region — so it scrolled away once there were more than a screenful of
				    conversations. The docs are explicit that SidebarContent is the scrollable area
				    and SidebarFooter is sticky, and help is an action like the profile menu. */}
				<SidebarFooter>
					<HelpDialog />
					<SidebarUser signOut={signOut} username={user.username} />
				</SidebarFooter>

				<SidebarRail />
			</Sidebar>

			<SidebarInset id="main">
				{/* Absolutely positioned, so toggling the sidebar never reflows the page header
				    underneath. 28px meets WCAG 2.2's 24px minimum for a mouse; pointer-coarse
				    grows both to 44px on a phone, where this is the only way to start a chat
				    without opening the drawer first. */}
				<div className="absolute top-3 inset-s-3 z-10 flex items-center gap-1">
					{/* Always visible, not md:hidden: collapsing the sidebar on a desktop otherwise
					    leaves only the 4px rail, with nothing that reads as a way back. */}
					<SidebarTrigger
						aria-label="نمایش یا بستن فهرست گفتگوها"
						className="pointer-coarse:size-11"
					/>
					<Link
						aria-label="گفتگوی تازه"
						className={buttonVariants({
							variant: "ghost",
							size: "icon-sm",
							className: "pointer-coarse:size-11",
						})}
						href="/"
					>
						<PlusIcon aria-hidden="true" />
					</Link>
				</div>
				{children}
			</SidebarInset>
		</SidebarProvider>
	);
}
