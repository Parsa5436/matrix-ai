"use client";

import { HelpCircleIcon } from "lucide-react";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import {
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from "@/components/ui/sidebar";

// Written for a fifteen-year-old, not for the client. The one thing it has to land is that
// the answers come from their own teacher's notes, because that is the only reason to open
// this instead of a general chatbot.
const SECTIONS = [
	{
		title: "این با بقیه‌ی چت‌بات‌ها فرق دارد",
		body: "اینجا جواب‌ها از روی جزوه‌ی خودِ استادت ساخته می‌شوند — همان روشی که سر کلاس درس داده، با همان ترتیب مرحله‌ها و همان میان‌برها. یک ربات عمومی مسئله را به روش خودش حل می‌کند؛ این یکی به روش او.",
		image: {
			src: "/help/teacher-method.webp",
			alt: "کنار هم: حل یک مسئله به روش کتاب، و همان مسئله به روش استاد",
			width: 640,
			height: 360,
		},
	},
	{
		title: "چطور خوب بپرسی",
		body: "از صورت سؤال عکس بگیر و بفرست، یا خودت تایپش کن. اگر سؤال چندگزینه‌ای است، گزینه‌ها را هم بنویس — بدون آن‌ها فقط می‌تواند راه حل را نشان بدهد، نه اینکه بگوید کدام گزینه درست است. اول درس را از بالای صفحه انتخاب کن.",
		image: {
			src: "/help/how-to-ask.webp",
			alt: "صفحه‌ی گوشی که در حال عکس گرفتن از یک سؤال تستی است",
			width: 640,
			height: 360,
		},
	},
	{
		title: "برچسب بالای هر جواب",
		body: "«روش استاد» یعنی جواب از روی جزوه و حل‌های خود استادت ساخته شده. «روش استاندارد» یعنی برای این سؤال چیزی از او پیدا نشد و مسئله به روش کتاب درسی حل شده — جواب درست است، ولی روشش مال او نیست. این را پنهان نمی‌کنیم.",
		image: null,
	},
	{
		title: "جواب‌ها از کجا می‌آیند",
		body: "از جزوه و اسلایدهای خود استادت، که خط به خط خوانده و ذخیره شده‌اند. پایین هر جواب می‌توانی ببینی از کدام قسمت‌ها استفاده شده است.",
		image: {
			src: "/help/sources.webp",
			alt: "یک اسلاید دست‌نویس استاد و فهرست منابع زیر جواب",
			width: 640,
			height: 360,
		},
	},
];

export function HelpDialog() {
	return (
		<Dialog>
			<SidebarMenu>
				<SidebarMenuItem>
					<DialogTrigger
						render={
							<SidebarMenuButton tooltip="راهنما">
								<HelpCircleIcon aria-hidden="true" />
								<span>راهنما</span>
							</SidebarMenuButton>
						}
					/>
				</SidebarMenuItem>
			</SidebarMenu>

			<DialogContent className="max-h-[85svh] gap-0 overflow-y-auto sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>راهنمای استاد</DialogTitle>
					<DialogDescription>
						در یک دقیقه: این چیست و چطور ازش بیشترین را بگیری.
					</DialogDescription>
				</DialogHeader>

				<div className="mt-4 space-y-6">
					{SECTIONS.map((section) => (
						<section className="space-y-2" key={section.title}>
							<h3 className="font-semibold text-base">{section.title}</h3>
							<p className="text-muted-foreground leading-7">{section.body}</p>
							{section.image && (
								/* A plain <img>, not next/image: these files are supplied later, and the
								   image optimizer throws on a missing local source, which would take the
								   whole dialog down. An <img> just does not paint. width/height are set
								   so the dialog does not jump as each one arrives. */
								// biome-ignore lint/performance/noImgElement: see above
								<img
									alt={section.image.alt}
									className="w-full rounded-lg border border-border"
									height={section.image.height}
									loading="lazy"
									src={section.image.src}
									width={section.image.width}
								/>
							)}
						</section>
					))}
				</div>
			</DialogContent>
		</Dialog>
	);
}
