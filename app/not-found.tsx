import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

// Next's built-in 404 is English, and every user-facing string here is Persian. This is also
// what another user's conversation looks like — see getConversation — so the wording says
// "not found", never "not yours".
export default function NotFound() {
	return (
		/* A <div>: this renders inside SidebarInset, which is already the page's <main>. */
		<div className="flex h-svh flex-col items-center justify-center gap-4 p-6 text-center">
			<h1 className="font-bold text-xl">این صفحه پیدا نشد</h1>
			<p className="text-muted-foreground text-sm">
				شاید نشانی را اشتباه وارد کرده‌اید یا این گفتگو دیگر وجود ندارد.
			</p>
			<Link className={buttonVariants({ variant: "secondary" })} href="/">
				بازگشت به گفتگوی جدید
			</Link>
		</div>
	);
}
