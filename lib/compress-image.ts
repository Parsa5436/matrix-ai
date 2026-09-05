// Shrink a camera photo before it leaves the phone. A 12-megapixel JPEG is several
// megabytes and costs a large number of image tokens for no accuracy gain — the model reads
// a question at 1600px exactly as well.
//
// Browser-only: canvas and createImageBitmap do not exist on the server.

const MAX_EDGE = 1600;
const QUALITY = 0.82;

export type CompressedImage = { blob: Blob; mediaType: string };

export async function compressImage(file: File): Promise<CompressedImage> {
	// Anything the browser cannot decode — HEIC on most desktops — throws here rather than
	// silently uploading megabytes the model cannot read.
	const bitmap = await createImageBitmap(file);
	const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
	const width = Math.round(bitmap.width * scale);
	const height = Math.round(bitmap.height * scale);

	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext("2d");
	if (!context) throw new Error("canvas 2d context unavailable");
	context.drawImage(bitmap, 0, 0, width, height);
	bitmap.close();

	// WebP is markedly smaller than JPEG at the same legibility, and the upload route accepts
	// it. Safari has supported encoding it since 14.
	const blob = await new Promise<Blob | null>((resolve) =>
		canvas.toBlob(resolve, "image/webp", QUALITY),
	);
	if (!blob) throw new Error("could not encode the image");
	return { blob, mediaType: "image/webp" };
}
