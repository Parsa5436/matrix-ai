import { currentUserId } from "@/lib/auth/session";
import {
	ACCEPTED_IMAGE_TYPES,
	imagePath,
	MAX_UPLOAD_BYTES,
	putImage,
} from "@/lib/storage";

export const runtime = "nodejs"; // the filesystem and Buffer do not exist on Edge.
export const maxDuration = 30;

// Type and size are checked here, on the bytes we actually received, not on what the client
// claimed. A 20MB HEIC has to come back as a sentence the student can read — the composer
// shows whatever `error` says.
export async function POST(req: Request) {
	if (!(await currentUserId())) {
		return Response.json(
			{ error: "برای فرستادن عکس وارد حساب خود شو." },
			{ status: 401 },
		);
	}

	const form = await req.formData().catch(() => null);
	const file = form?.get("file");
	if (!(file instanceof File)) {
		return Response.json({ error: "فایلی دریافت نشد." }, { status: 400 });
	}

	if (
		!ACCEPTED_IMAGE_TYPES.includes(
			file.type as (typeof ACCEPTED_IMAGE_TYPES)[number],
		)
	) {
		// HEIC is the common one: iPhones shoot it by default and no model here reads it.
		return Response.json(
			{
				error:
					"این نوع فایل پشتیبانی نمی‌شود. عکس باید JPEG، PNG یا WebP باشد — از گوشی، «سازگارترین» را در تنظیمات دوربین انتخاب کن.",
			},
			{ status: 415 },
		);
	}

	const data = new Uint8Array(await file.arrayBuffer());
	if (data.byteLength > MAX_UPLOAD_BYTES) {
		const megabytes = (MAX_UPLOAD_BYTES / 1024 / 1024).toFixed(0);
		return Response.json(
			{ error: `عکس خیلی بزرگ است. حداکثر ${megabytes} مگابایت.` },
			{ status: 413 },
		);
	}
	if (data.byteLength === 0) {
		return Response.json({ error: "فایل خالی بود." }, { status: 400 });
	}

	const id = await putImage(data, file.type);
	return Response.json({ url: imagePath(id), mediaType: file.type });
}
