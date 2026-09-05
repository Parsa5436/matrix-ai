"use client";

import {
	ChevronsUpDownIcon,
	LogOutIcon,
	MoonIcon,
	SunIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	useSidebar,
} from "@/components/ui/sidebar";

/** The teacher's own initial, so the row is recognisable before you read it. */
const initialOf = (username: string) =>
	username.trim().charAt(0).toUpperCase() || "؟";

export function SidebarUser({
	username,
	signOut,
}: {
	username: string;
	signOut: () => Promise<void>;
}) {
	const { isMobile } = useSidebar();
	const { resolvedTheme, setTheme } = useTheme();
	// The server cannot know the resolved theme, so everything that depends on it waits for
	// mount. Naming only the icon and not the label is a hydration mismatch.
	const [mounted, setMounted] = useState(false);
	useEffect(() => setMounted(true), []);
	const dark = resolvedTheme === "dark";

	return (
		<SidebarMenu>
			<SidebarMenuItem>
				<DropdownMenu>
					<DropdownMenuTrigger
						render={
							<SidebarMenuButton
								className="h-12 data-open:bg-sidebar-accent data-open:text-sidebar-accent-foreground"
								size="lg"
							/>
						}
					>
						<Avatar size="sm">
							<AvatarFallback>{initialOf(username)}</AvatarFallback>
						</Avatar>
						<span
							className="flex-1 truncate text-start"
							dir="ltr"
							translate="no"
						>
							{username}
						</span>
						<ChevronsUpDownIcon aria-hidden="true" />
					</DropdownMenuTrigger>

					<DropdownMenuContent
						align="end"
						className="min-w-56"
						side={isMobile ? "bottom" : "top"}
					>
						{/* base-ui's GroupLabel throws outside a Group; shadcn's docs show the
						    label bare, but this build requires the wrapper. */}
						<DropdownMenuGroup>
							<DropdownMenuLabel className="font-normal">
								<div className="flex items-center gap-2">
									<Avatar size="sm">
										<AvatarFallback>{initialOf(username)}</AvatarFallback>
									</Avatar>
									<span className="truncate text-sm" dir="ltr" translate="no">
										{username}
									</span>
								</div>
							</DropdownMenuLabel>
						</DropdownMenuGroup>

						<DropdownMenuSeparator />

						<DropdownMenuItem
							closeOnClick={false}
							onClick={() => setTheme(dark ? "light" : "dark")}
						>
							{mounted && dark ? (
								<SunIcon aria-hidden="true" />
							) : (
								<MoonIcon aria-hidden="true" />
							)}
							{mounted
								? dark
									? "حالت روشن"
									: "حالت تاریک"
								: "تغییر روشنایی صفحه"}
						</DropdownMenuItem>

						<DropdownMenuSeparator />

						<DropdownMenuItem onClick={() => signOut()} variant="destructive">
							<LogOutIcon aria-hidden="true" />
							خروج از حساب
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</SidebarMenuItem>
		</SidebarMenu>
	);
}
