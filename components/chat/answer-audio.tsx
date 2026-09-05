"use client";

import { Volume2Icon } from "lucide-react";
import { useState } from "react";
import {
	AudioPlayer,
	AudioPlayerControlBar,
	AudioPlayerDurationDisplay,
	AudioPlayerElement,
	AudioPlayerPlayButton,
	AudioPlayerTimeDisplay,
	AudioPlayerTimeRange,
} from "@/components/ai-elements/audio-player";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Button } from "@/components/ui/button";

// Three states, one chain: no audio yet → generating → a player. Which one shows is decided
// by `url` and `pending`, not by a machine.
//
// Never autoplays. The audio is generated once and stored, so a second visit renders the
// player straight away and the student presses play — that is what the storage buys.
export function AnswerAudio({
	messageId,
	initialUrl,
}: {
	messageId: string;
	initialUrl?: string | null;
}) {
	const [url, setUrl] = useState(initialUrl ?? null);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const generate = async () => {
		setPending(true);
		setError(null);
		try {
			const response = await fetch("/api/speech", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ messageId }),
			});
			if (!response.ok) {
				setError(await response.text());
				return;
			}
			const { url: generated } = (await response.json()) as { url: string };
			setUrl(generated);
		} catch {
			setError("ارتباط قطع شد. دوباره تلاش کن.");
		} finally {
			setPending(false);
		}
	};

	if (url) {
		return (
			// No border here: ButtonGroup already draws one around the control row, and a second
			// one on the root painted a box inside a box.
			<AudioPlayer className="w-full max-w-sm">
				<AudioPlayerElement preload="metadata" src={url} />
				<AudioPlayerControlBar>
					<AudioPlayerPlayButton aria-label="پخش و توقف" />
					{/* DOM order is reading order, and the bar is LTR: elapsed, scrubber, total. */}
					<AudioPlayerTimeDisplay />
					<AudioPlayerTimeRange aria-label="جابه‌جایی در صدا" />
					<AudioPlayerDurationDisplay />
				</AudioPlayerControlBar>
			</AudioPlayer>
		);
	}

	return (
		<div aria-live="polite" className="flex flex-col gap-1.5">
			{pending ? (
				// Named, not a bare spinner: two model calls take upwards of ten seconds, and a
				// student staring at a spinner cannot tell that from a hang.
				<Shimmer className="text-muted-foreground text-sm">
					دارم پاسخ را برایت می‌خوانم…
				</Shimmer>
			) : (
				<Button
					className="w-fit gap-1.5 pointer-coarse:h-11"
					onClick={generate}
					size="sm"
					variant="outline"
				>
					<Volume2Icon aria-hidden="true" />
					گوش کن
				</Button>
			)}

			{error && (
				<p className="text-destructive text-sm" role="alert">
					{error}
				</p>
			)}
		</div>
	);
}
