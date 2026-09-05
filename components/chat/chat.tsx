"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { SparklesIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import {
	Attachment,
	AttachmentPreview,
	AttachmentRemove,
	Attachments,
} from "@/components/ai-elements/attachments";
import {
	Conversation,
	ConversationContent,
	ConversationEmptyState,
	ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent } from "@/components/ai-elements/message";
import {
	PromptInput,
	PromptInputActionAddAttachments,
	PromptInputActionMenu,
	PromptInputActionMenuContent,
	PromptInputActionMenuTrigger,
	PromptInputBody,
	PromptInputFooter,
	PromptInputSubmit,
	PromptInputTextarea,
	PromptInputTools,
	usePromptInputAttachments,
} from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { compressImage } from "@/lib/compress-image";
import type { SubjectOption } from "@/lib/db/subjects";
import type { ConversationUsage } from "@/lib/db/usage";
import { AnswerCard } from "./answer-card";
import { ContextUsage } from "./context-usage";

// Openers, not examples. A blank box is the hardest thing to hand a fifteen-year-old. Each
// one is short enough to read inside a chip and lands on a topic the corpus actually covers.
const OPENERS = [
	"چگالی چیست؟",
	"تبدیل یکا",
	"کمیت اصلی و فرعی",
	"دقت وسایل اندازه‌گیری",
	"داده‌ی پرت",
];

// The picker lives in prompt-input; rendering what was picked is the separate `attachments`
// component. This bridges them — it must be inside <PromptInput> to reach the context.
function PendingAttachments() {
	const attachments = usePromptInputAttachments();
	if (attachments.files.length === 0) return null;
	return (
		<Attachments className="px-3 pt-3" variant="grid">
			{attachments.files.map((file) => (
				<Attachment
					data={file}
					key={file.id}
					onRemove={() => attachments.remove(file.id)}
				>
					<AttachmentPreview />
					<AttachmentRemove aria-label="حذف عکس" />
				</Attachment>
			))}
		</Attachments>
	);
}

export function Chat({
	subjects,
	initialMessages,
	conversationId,
	subjectId,
	usage,
	contextLimit,
}: {
	subjects: SubjectOption[];
	initialMessages: UIMessage[];
	conversationId?: string;
	subjectId?: string;
	usage?: ConversationUsage;
	contextLimit?: number;
}) {
	const [subject, setSubject] = useState(subjectId ?? subjects[0]?.id ?? "");
	// A ref, not state: the first reply carries the id of the conversation the server just
	// created, and the next request has to send it. Re-rendering on that would restart the
	// stream mid-answer.
	const conversation = useRef(conversationId);
	const router = useRouter();
	const [uploading, setUploading] = useState(false);
	const [uploadError, setUploadError] = useState<string | null>(null);

	const { messages, sendMessage, status, error } = useChat({
		messages: initialMessages,
		transport: new DefaultChatTransport({
			api: "/api/chat",
			prepareSendMessagesRequest: ({ messages: body }) => ({
				body: {
					messages: body,
					subjectId: subject || undefined,
					conversationId: conversation.current,
				},
			}),
		}),
		onData: (part) => {
			if (part.type !== "data-conversation") return;
			const { id } = part.data as { id: string };
			conversation.current = id;
			// Deep-linkable from the first reply. replaceState rather than router.push, which
			// would remount the tree and tear down the open stream.
			window.history.replaceState(null, "", `/c/${id}`);
		},
		// Two things happen once the answer is complete, both deliberately not during it.
		// refresh() revalidates the server-rendered sidebar, which otherwise would not show
		// the conversation until a manual reload. replace() tells the router what
		// replaceState already told the address bar, so the sidebar can mark the row active —
		// usePathname reads the router, not the URL.
		onFinish: () => {
			router.refresh();
			if (conversation.current) {
				router.replace(`/c/${conversation.current}`, { scroll: false });
			}
		},
	});

	// Compress, upload, then send. The composer hands back a data URL, which would put a
	// multi-megabyte string in the request body and in the stored message; what goes to the
	// server instead is a short /api/files path.
	const handleSubmit = async (message: {
		text: string;
		files: { url?: string; filename?: string; mediaType?: string }[];
	}) => {
		const picked = message.files[0];
		if (!message.text.trim() && !picked) return;
		setUploadError(null);

		if (!picked?.url) {
			sendMessage({ text: message.text });
			return;
		}

		setUploading(true);
		try {
			const original = await fetch(picked.url).then((r) => r.blob());
			const { blob, mediaType } = await compressImage(
				new File([original], picked.filename ?? "photo", {
					type: picked.mediaType ?? original.type,
				}),
			);
			const form = new FormData();
			form.append("file", blob, "question.webp");
			const response = await fetch("/api/upload", {
				method: "POST",
				body: form,
			});
			const result = (await response.json()) as {
				url?: string;
				error?: string;
			};
			if (!response.ok || !result.url) {
				setUploadError(result.error ?? "فرستادن عکس نشد. دوباره تلاش کن.");
				return;
			}
			sendMessage({
				text: message.text,
				files: [{ type: "file", mediaType, url: result.url }],
			});
		} catch {
			// createImageBitmap throws on formats the browser cannot decode — HEIC, mostly.
			setUploadError(
				"این عکس خوانده نشد. اگر از آیفون می‌فرستی، در تنظیمات دوربین «سازگارترین» را انتخاب کن.",
			);
		} finally {
			setUploading(false);
		}
	};

	const lastId = messages.at(-1)?.id;
	const waiting = status === "submitted";

	return (
		/* SidebarInset is the page's <main>; a second one here would be invalid HTML.
		   Full width on purpose: the scroll container below has to reach the edge of the
		   main area, and only its contents are centred. */
		<div className="flex h-svh w-full flex-col">
			<header className="mx-auto flex w-full max-w-3xl items-center justify-center gap-2 px-4 py-3 ps-24 md:ps-4">
				<label
					className="text-muted-foreground text-sm"
					htmlFor="subject-trigger"
				>
					درس
				</label>
				<Select
					disabled={Boolean(conversationId)}
					items={subjects.map((s) => ({ label: s.title, value: s.id }))}
					onValueChange={(value) => setSubject(String(value))}
					value={subject}
				>
					<SelectTrigger id="subject-trigger">
						<SelectValue placeholder="درسی موجود نیست" />
					</SelectTrigger>
					<SelectContent>
						{subjects.map((option) => (
							<SelectItem key={option.id} value={option.id}>
								{option.title}
							</SelectItem>
						))}
					</SelectContent>
				</Select>

				{usage && contextLimit && (
					<ContextUsage maxTokens={contextLimit} usage={usage} />
				)}
			</header>

			{/* The scroll container spans the whole main area so its scrollbar lands at the
			    far edge — the left, in RTL — instead of hugging the message column. */}
			<Conversation>
				<ConversationContent className="mx-auto w-full max-w-3xl">
					{messages.length === 0 ? (
						/* children replace the built-in title/description rather than joining
						   them, so the whole empty state is supplied here. */
						<ConversationEmptyState>
							<SparklesIcon
								aria-hidden="true"
								className="size-8 text-primary"
							/>
							<div className="space-y-1">
								<h2 className="font-semibold text-lg">خب، از کجا شروع کنیم؟</h2>
								<p className="text-muted-foreground text-sm">
									هر سؤالی از فصل داری بپرس — قدم‌به‌قدم با هم حلش می‌کنیم.
								</p>
							</div>
							<Suggestions className="mt-2">
								{OPENERS.map((opener) => (
									<Suggestion
										key={opener}
										onClick={(text) => sendMessage({ text })}
										suggestion={opener}
									/>
								))}
							</Suggestions>
						</ConversationEmptyState>
					) : (
						messages.map((message) => (
							<Message from={message.role} key={message.id}>
								<MessageContent dir="auto">
									{message.role === "assistant" ? (
										<AnswerCard
											isStreaming={
												status === "streaming" && message.id === lastId
											}
											message={message}
										/>
									) : (
										<>
											{message.parts
												.filter((part) => part.type === "file")
												.map((part) => (
													// biome-ignore lint/performance/noImgElement: an authenticated /api/files path, which the optimizer cannot fetch
													<img
														alt="عکس سؤال"
														className="mb-2 max-h-72 w-auto rounded-lg border border-border"
														key={part.url}
														src={part.url}
													/>
												))}
											{message.parts
												.filter((part) => part.type === "text")
												.map((part) => part.text)
												.join("")}
										</>
									)}
								</MessageContent>
							</Message>
						))
					)}

					{waiting && (
						<Shimmer className="text-sm">دارم جزوه‌ی استاد را می‌خوانم…</Shimmer>
					)}
				</ConversationContent>
				<ConversationScrollButton />
			</Conversation>

			<div aria-live="polite" className="mx-auto w-full max-w-3xl empty:hidden">
				{(uploadError || error) && (
					<p className="px-4 pb-2 text-destructive text-sm" role="alert">
						{uploadError ||
							error?.message ||
							"ارتباط با سرویس برقرار نشد. چند لحظه بعد دوباره تلاش کن."}
					</p>
				)}
			</div>

			<PromptInput
				accept="image/jpeg,image/png,image/webp"
				className="mx-auto mb-4 w-full max-w-3xl px-4"
				maxFiles={1}
				// Generous: the raw pick is compressed before it is uploaded, and the real
				// ceiling is enforced server-side on the bytes we actually receive.
				maxFileSize={25 * 1024 * 1024}
				onError={(problem) =>
					setUploadError(
						problem.code === "accept"
							? "فقط عکس می‌شود فرستاد — JPEG، PNG یا WebP."
							: problem.code === "max_files"
								? "فعلاً هر بار یک عکس."
								: "این عکس خیلی بزرگ است.",
					)
				}
				onSubmit={handleSubmit}
			>
				<PromptInputBody>
					<PendingAttachments />
					<PromptInputTextarea placeholder="سؤالت را اینجا بنویس…" />
				</PromptInputBody>
				<PromptInputFooter>
					<PromptInputTools>
						<PromptInputActionMenu>
							<PromptInputActionMenuTrigger />
							<PromptInputActionMenuContent>
								<PromptInputActionAddAttachments label="عکس سؤال" />
							</PromptInputActionMenuContent>
						</PromptInputActionMenu>
					</PromptInputTools>
					<PromptInputSubmit status={uploading ? "submitted" : status} />
				</PromptInputFooter>
			</PromptInput>
		</div>
	);
}
