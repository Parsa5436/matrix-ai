"use client";

import type { UIMessage } from "ai";
import {
	BookOpenIcon,
	CheckIcon,
	CopyIcon,
	PenLineIcon,
	SearchIcon,
	SparklesIcon,
	TagIcon,
	WandSparklesIcon,
} from "lucide-react";
import { useState } from "react";
import {
	ChainOfThought,
	ChainOfThoughtContent,
	ChainOfThoughtHeader,
	ChainOfThoughtStep,
} from "@/components/ai-elements/chain-of-thought";
import {
	MessageAction,
	MessageActions,
	MessageResponse,
} from "@/components/ai-elements/message";
import {
	Sources,
	SourcesContent,
	SourcesTrigger,
} from "@/components/ai-elements/sources";
import { Badge } from "@/components/ui/badge";
import type { AnswerMode, AnswerStage, SourceRef } from "@/lib/answer/types";
import { toPersianDigits } from "@/lib/persian";
import { AnswerAudio } from "./answer-audio";

// The badge is read off the stream, never inferred here. assemble() sets "teacher" only when
// an approved method card or the teacher's own exemplars actually reached the prompt, and
// contract clause 6 requires the product to admit when they did not. Recomputing it in the UI
// would create a second version of that truth, free to disagree.
const MODES = {
	teacher: { label: "روش استاد", icon: SparklesIcon, variant: "brand" },
	standard: { label: "روش استاندارد", icon: BookOpenIcon, variant: "outline" },
	general: { label: "گفتگوی عمومی", icon: BookOpenIcon, variant: "ghost" },
} as const;

// One entry per stage the pipeline can report. There is no entry for a stage it cannot
// describe truthfully — the pipeline sends nothing in that case, so nothing renders.
const STAGES = {
	condense: { label: "بازنویسی پرسش برای جستجو", icon: WandSparklesIcon },
	classify: { label: "تشخیص موضوع", icon: TagIcon },
	retrieve: { label: "جستجو در جزوه‌ی استاد", icon: SearchIcon },
	generate: { label: "نوشتن پاسخ", icon: PenLineIcon },
} as const;

function dataPart<T>(message: UIMessage, type: string): T | undefined {
	const part = message.parts.find((p) => p.type === type);
	return part && "data" in part ? (part.data as T) : undefined;
}

export function AnswerCard({
	message,
	isStreaming,
}: {
	message: UIMessage;
	isStreaming: boolean;
}) {
	const mode = dataPart<{ mode: AnswerMode }>(message, "data-mode")?.mode;
	const sources =
		dataPart<{ sources: SourceRef[] }>(message, "data-sources")?.sources ?? [];
	const stages =
		dataPart<{ stages: AnswerStage[] }>(message, "data-stages")?.stages ?? [];
	// The database row id. It arrives as a data part on the turn that created the message and
	// as the message's own id on every visit after that.
	const storedId =
		dataPart<{ id: string }>(message, "data-message")?.id ?? message.id;
	const audioUrl = dataPart<{ url: string }>(message, "data-audio")?.url;
	const text = message.parts
		.filter((part) => part.type === "text")
		.map((part) => part.text)
		.join("");

	const badge = mode ? MODES[mode] : undefined;
	const [copied, setCopied] = useState(false);

	const copy = async () => {
		await navigator.clipboard.writeText(text);
		setCopied(true);
		// Long enough to read, short enough that the button is never stale.
		setTimeout(() => setCopied(false), 2000);
	};

	return (
		<div className="flex flex-col gap-3">
			{stages.length > 0 && (
				// Closed by default: a student wants the answer, not the machinery. Open, it is
				// the honest account of what was searched and what came back.
				<ChainOfThought>
					<ChainOfThoughtHeader>مراحل پاسخ</ChainOfThoughtHeader>
					<ChainOfThoughtContent>
						{stages.map((stage, index) => (
							<ChainOfThoughtStep
								description={stage.detail}
								icon={STAGES[stage.name].icon}
								key={stage.name}
								label={STAGES[stage.name].label}
								// Only the last one can still be running, and only while text is
								// arriving — after that every stage really did finish.
								status={
									isStreaming && index === stages.length - 1
										? "active"
										: "complete"
								}
							/>
						))}
					</ChainOfThoughtContent>
				</ChainOfThought>
			)}

			{badge && (
				<Badge className="gap-1.5" variant={badge.variant}>
					<badge.icon aria-hidden="true" />
					{badge.label}
				</Badge>
			)}

			<MessageResponse className="prose-math" isAnimating={isStreaming}>
				{text}
			</MessageResponse>

			{/* Hidden while the answer is still arriving: copying half a solution is worse
			    than waiting for it. */}
			{!isStreaming && text.length > 0 && (
				<div className="flex flex-wrap items-center gap-2">
					<MessageActions>
						<MessageAction
							className="pointer-coarse:size-11"
							label={copied ? "کپی شد" : "کپی متن پاسخ"}
							onClick={copy}
							tooltip={copied ? "کپی شد" : "کپی متن پاسخ"}
						>
							{copied ? (
								<CheckIcon aria-hidden="true" />
							) : (
								<CopyIcon aria-hidden="true" />
							)}
						</MessageAction>
					</MessageActions>
					<AnswerAudio initialUrl={audioUrl} messageId={storedId} />
				</div>
			)}

			{sources.length > 0 && (
				<Sources className="mb-0">
					<SourcesTrigger
						className="rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
						count={sources.length}
					>
						<span className="font-medium">
							بر پایه‌ی {toPersianDigits(String(sources.length))} منبع از جزوه‌ی
							استاد
						</span>
					</SourcesTrigger>
					<SourcesContent>
						{/* Not <Source>: that ships an <a target="_blank">, and these cite slides in
						    the teacher's own deck, which have no URL to open yet. */}
						<ul className="flex flex-wrap gap-1.5">
							{sources.map((source) => (
								<li key={`${source.kind}-${source.id}`}>
									<Badge variant="secondary">
										{source.kind === "method-card"
											? `کارت روش — ${source.label}`
											: source.label}
									</Badge>
								</li>
							))}
						</ul>
					</SourcesContent>
				</Sources>
			)}
		</div>
	);
}
