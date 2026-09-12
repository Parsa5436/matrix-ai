import "katex/dist/katex.min.css";
import "./globals.css";
import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { ThemeProvider } from "@/components/theme-provider";
import { DirectionProvider } from "@/components/ui/direction";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// Self-hosted: `next/font/google` fetches at build time, and builds run from Iran.
const fontSans = localFont({
	src: "./fonts/Vazirmatn-Variable.woff2",
	weight: "100 900",
	display: "swap",
	variable: "--font-sans",
});

import { ASSISTANT_INTRO, TEACHER_NAME } from "@/lib/brand";
export const metadata: Metadata = {
	title: `${TEACHER_NAME} — ${ASSISTANT_INTRO}`,
	description:
		"سؤالت را بپرس و ببین استاد یحیوی چطور حلش می‌کند: قدم‌به‌قدم، به روش خودش.",
};

export const viewport: Viewport = {
	// Matches --background in each mode so the mobile browser chrome does not flash white.
	themeColor: [
		{ media: "(prefers-color-scheme: light)", color: "#ffffff" },
		{ media: "(prefers-color-scheme: dark)", color: "#242424" },
	],
};

export default function RootLayout({
	children,
}: Readonly<{ children: React.ReactNode }>) {
	return (
		<html
			className={cn("antialiased", fontSans.variable)}
			dir="rtl"
			lang="fa"
			suppressHydrationWarning
		>
			<body>
				<a
					className="sr-only rounded-md bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:absolute focus:top-3 focus:start-3 focus:z-50"
					href="#main"
				>
					رفتن به محتوای اصلی
				</a>
				<DirectionProvider direction="rtl">
					<ThemeProvider>
						<TooltipProvider>{children}</TooltipProvider>
					</ThemeProvider>
				</DirectionProvider>
			</body>
		</html>
	);
}
