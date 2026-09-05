import { currentUserId } from "@/lib/auth/session";
import { getStored } from "@/lib/storage";

export const runtime = "nodejs";

// Uploads live outside public/ so they are not world-readable by anyone who guesses an id.
// This is the only way back out, and it requires a session.
//
// ponytail: any signed-in user can read any id. Scoping a file to its uploader needs an
// owner column, which is worth adding the moment uploads outlive the conversation.
export async function GET(
	_req: Request,
	{ params }: { params: Promise<{ id: string }> },
) {
	if (!(await currentUserId())) return new Response(null, { status: 401 });

	const { id } = await params;
	const image = await getStored(id);
	if (!image) return new Response(null, { status: 404 });

	return new Response(image.data as BodyInit, {
		headers: {
			"Content-Type": image.mediaType,
			// Immutable: the id is a uuid, so the bytes behind it never change.
			"Cache-Control": "private, max-age=31536000, immutable",
		},
	});
}
