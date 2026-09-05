"use client";

import { MessageSquareTextIcon, SparklesIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
	SidebarGroup,
	SidebarGroupLabel,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from "@/components/ui/sidebar";

export type ConversationSummary = {
	id: string;
	title: string;
	updatedAt: Date;
};

const DAY = 24 * 60 * 60 * 1000;

// Buckets, newest first. A flat list of forty titles is a wall; "امروز" tells a student
// where they were without reading any of them.
const BUCKETS = [
	{ label: "امروز", maxAgeDays: 1 },
	{ label: "هفته‌ی گذشته", maxAgeDays: 7 },
	{ label: "ماه گذشته", maxAgeDays: 30 },
	{ label: "قدیمی‌تر", maxAgeDays: Number.POSITIVE_INFINITY },
] as const;

// The last bucket is unbounded, so find() always matches; the fallback is only for the
// type checker, which cannot know that.
const bucketLabel = (updatedAt: Date, now: number) => {
	const ageDays = (now - updatedAt.getTime()) / DAY;
	return (BUCKETS.find((b) => ageDays < b.maxAgeDays) ?? BUCKETS[3]).label;
};

// A client component only because the active row depends on the current path, which a
// layout cannot read.
//
// `now` is passed in rather than read here: the server renders this component too, and a
// clock difference of a few seconds across a bucket boundary is a hydration mismatch. One
// timestamp, sent with the HTML, means both sides bucket identically.
export function ConversationList({
	conversations,
	now,
}: {
	conversations: ConversationSummary[];
	now: number;
}) {
	const pathname = usePathname();

	if (conversations.length === 0) {
		return (
			<SidebarGroup>
				<div className="flex flex-col items-center gap-2 px-2 py-8 text-center">
					<SparklesIcon
						aria-hidden="true"
						className="size-6 text-muted-foreground"
					/>
					<p className="font-medium text-sm">هنوز گفتگویی نداری</p>
					<p className="text-muted-foreground text-xs leading-5">
						اولین سؤالت را بپرس — هر گفتگو اینجا ذخیره می‌شود تا بعداً دوباره
						مرورش کنی.
					</p>
				</div>
			</SidebarGroup>
		);
	}

	const grouped = BUCKETS.map((b) => ({
		label: b.label,
		items: conversations.filter(
			(c) => bucketLabel(c.updatedAt, now) === b.label,
		),
	})).filter((g) => g.items.length > 0);

	return (
		<>
			{grouped.map((group) => (
				<SidebarGroup key={group.label}>
					<SidebarGroupLabel>{group.label}</SidebarGroupLabel>
					<SidebarMenu>
						{group.items.map((conversation) => (
							<SidebarMenuItem key={conversation.id}>
								<SidebarMenuButton
									className="group/row h-9 transition-colors"
									isActive={pathname === `/c/${conversation.id}`}
									render={<Link href={`/c/${conversation.id}`} />}
									tooltip={conversation.title}
								>
									<MessageSquareTextIcon
										aria-hidden="true"
										className="text-muted-foreground transition-colors group-hover/row:text-sidebar-accent-foreground group-data-[active]/row:text-sidebar-accent-foreground"
									/>
									<span className="truncate">{conversation.title}</span>
								</SidebarMenuButton>
							</SidebarMenuItem>
						))}
					</SidebarMenu>
				</SidebarGroup>
			))}
		</>
	);
}
