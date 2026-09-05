import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

// Uploaded images and generated audio, behind one small interface.
//
// The spec calls for domestic object storage and there are no credentials for one yet, so
// this writes to a directory on the host. Everything above it only ever sees an id, so
// swapping in an S3-compatible bucket is this file and nothing else.
//
// Deliberately NOT public/: Next serves that statically, which would make every upload
// world-readable by anyone who guesses an id. Reads go through a route that checks the
// session first.

const ROOT = resolve(process.env.UPLOAD_DIR ?? ".uploads");

/** Only what the vision model can actually read, and what a phone camera produces. */
export const ACCEPTED_IMAGE_TYPES = [
	"image/jpeg",
	"image/png",
	"image/webp",
] as const;

export const MAX_UPLOAD_BYTES = 6 * 1024 * 1024;

const MEDIA_TYPES = {
	jpg: "image/jpeg",
	png: "image/png",
	webp: "image/webp",
	mp3: "audio/mpeg",
	wav: "audio/wav",
} as const;

type Extension = keyof typeof MEDIA_TYPES;

const extensionOf = (mediaType: string): Extension =>
	mediaType === "image/png"
		? "png"
		: mediaType === "image/webp"
			? "webp"
			: "jpg";

/** Stores the bytes and returns the opaque id used to read them back. */
export async function putImage(
	data: Uint8Array,
	mediaType: string,
): Promise<string> {
	await mkdir(ROOT, { recursive: true });
	const id = `${randomUUID()}.${extensionOf(mediaType)}`;
	await writeFile(join(ROOT, id), data);
	return id;
}

/**
 * Stores generated speech under a caller-chosen id, and reports whether it was already there.
 *
 * The id is a hash of the script, so the same narration never pays for a second generation
 * and a file on disk is traceable to the text that produced it.
 */
export async function putAudio(id: string, data: Uint8Array): Promise<void> {
	await mkdir(ROOT, { recursive: true });
	await writeFile(join(ROOT, id), data);
}

export const audioId = (scriptHash: string, extension: "mp3" | "wav") =>
	`${scriptHash}.${extension}`;

// One reader for both kinds. The id reaches this from a URL, so it must not be able to walk
// out of the directory: a uuid for an upload, a sha-256 for generated audio, nothing else.
export async function getStored(
	id: string,
): Promise<{ data: Uint8Array; mediaType: string } | null> {
	if (!/^(?:[0-9a-f-]{36}|[0-9a-f]{64})\.(jpg|png|webp|mp3|wav)$/.test(id))
		return null;
	const data = await readFile(join(ROOT, id)).catch(() => null);
	if (!data) return null;
	const extension = id.split(".").pop() as Extension;
	return { data, mediaType: MEDIA_TYPES[extension] };
}

/** The path the browser and the stored message parts refer to. */
export const imagePath = (id: string) => `/api/files/${id}`;
export const audioPath = imagePath;

/** The id inside one of our own image paths, or null if this is not one. */
export const imageIdFromPath = (url: string) =>
	url.startsWith("/api/files/") ? url.slice("/api/files/".length) : null;
