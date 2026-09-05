"use client";

import { BrainIcon, ChevronDownIcon, DotIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

// AI Elements' chain-of-thought, adapted to this stack. Three changes from the registry copy:
//
//   - Its Collapsible is Radix, so it ships a React context, a @radix-ui controllable-state
//     dependency and two sibling Collapsible roots to keep them in sync. Ours is base-ui,
//     whose Root already holds that state — so one Root and no context does the same job.
//   - `data-[state=open]` is Radix's attribute. base-ui writes `data-open` / `data-panel-open`.
//     Its slide-down animation went with it; base-ui hides the panel outright when closed, and
//     a height transition here has to be driven off --collapsible-panel-height, which is more
//     moving parts than four lines of Persian are worth.
//   - `text-left` and `left-1/2` are physical, and this page is RTL.

export type ChainOfThoughtProps = ComponentProps<typeof Collapsible>;

export const ChainOfThought = ({
	className,
	...props
}: ChainOfThoughtProps) => (
	<Collapsible
		className={cn("not-prose max-w-prose space-y-2", className)}
		{...props}
	/>
);

export type ChainOfThoughtHeaderProps = ComponentProps<
	typeof CollapsibleTrigger
>;

export const ChainOfThoughtHeader = ({
	className,
	children,
	...props
}: ChainOfThoughtHeaderProps) => (
	<CollapsibleTrigger
		className={cn(
			"group flex w-full items-center gap-2 rounded-md text-muted-foreground text-sm transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2",
			className,
		)}
		{...props}
	>
		<BrainIcon aria-hidden="true" className="size-4" />
		<span className="flex-1 text-start">{children}</span>
		<ChevronDownIcon
			aria-hidden="true"
			className="size-4 transition-transform group-data-[panel-open]:rotate-180"
		/>
	</CollapsibleTrigger>
);

export type ChainOfThoughtContentProps = ComponentProps<
	typeof CollapsibleContent
>;

export const ChainOfThoughtContent = ({
	className,
	...props
}: ChainOfThoughtContentProps) => (
	<CollapsibleContent
		className={cn("mt-2 space-y-3 text-popover-foreground", className)}
		{...props}
	/>
);

export type ChainOfThoughtStepProps = ComponentProps<"div"> & {
	icon?: typeof DotIcon;
	label: ReactNode;
	description?: ReactNode;
	status?: "complete" | "active" | "pending";
};

const STATUS_STYLES = {
	complete: "text-muted-foreground",
	active: "text-foreground",
	pending: "text-muted-foreground/50",
} as const;

export const ChainOfThoughtStep = ({
	className,
	icon: Icon = DotIcon,
	label,
	description,
	status = "complete",
	children,
	...props
}: ChainOfThoughtStepProps) => (
	<div
		className={cn(
			"flex animate-in gap-2 fade-in-0 text-sm slide-in-from-top-2",
			STATUS_STYLES[status],
			className,
		)}
		{...props}
	>
		<div className="relative mt-0.5">
			<Icon aria-hidden="true" className="size-4" />
			<div className="-mx-px absolute start-1/2 top-7 bottom-0 w-px bg-border" />
		</div>
		<div className="flex-1 space-y-2 overflow-hidden">
			<div>{label}</div>
			{description && (
				<div className="text-muted-foreground text-xs">{description}</div>
			)}
			{children}
		</div>
	</div>
);

export type ChainOfThoughtSearchResultsProps = ComponentProps<"div">;

export const ChainOfThoughtSearchResults = ({
	className,
	...props
}: ChainOfThoughtSearchResultsProps) => (
	<div
		className={cn("flex flex-wrap items-center gap-2", className)}
		{...props}
	/>
);

export type ChainOfThoughtSearchResultProps = ComponentProps<typeof Badge>;

export const ChainOfThoughtSearchResult = ({
	className,
	...props
}: ChainOfThoughtSearchResultProps) => (
	<Badge
		className={cn("gap-1 px-2 py-0.5 font-normal text-xs", className)}
		variant="secondary"
		{...props}
	/>
);
