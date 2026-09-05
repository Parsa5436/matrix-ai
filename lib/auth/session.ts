import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { env } from "@/lib/env";

// A signed cookie, not a session table. There is no server-side state to expire, revoke or
// clean up, and for an MVP with hand-created users that is the whole feature. If revocation
// is ever needed, a Session row keyed by a random id replaces the payload below and nothing
// else changes.

const COOKIE = "ostad_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

const sign = (payload: string) =>
	createHmac("sha256", env.SESSION_SECRET).update(payload).digest("base64url");

const signatureMatches = (payload: string, signature: string) => {
	const expected = Buffer.from(sign(payload));
	const actual = Buffer.from(signature);
	return actual.length === expected.length && timingSafeEqual(actual, expected);
};

/** The signed value for a user. Exported so the cookie format can be tested without Next. */
export function sessionToken(userId: string, expiresAt: number): string {
	const payload = `${userId}.${expiresAt}`;
	return `${payload}.${sign(payload)}`;
}

/** The user a token belongs to, or null if it is forged, malformed, or expired. */
export function userIdFromToken(token: string | undefined): string | null {
	if (!token) return null;
	const lastDot = token.lastIndexOf(".");
	if (lastDot < 0) return null;
	const payload = token.slice(0, lastDot);
	if (!signatureMatches(payload, token.slice(lastDot + 1))) return null;

	const split = payload.lastIndexOf(".");
	const userId = payload.slice(0, split);
	const expiresAt = Number(payload.slice(split + 1));
	if (!userId || !Number.isFinite(expiresAt) || expiresAt < Date.now())
		return null;
	return userId;
}

export async function startSession(userId: string): Promise<void> {
	const store = await cookies();
	store.set(COOKIE, sessionToken(userId, Date.now() + MAX_AGE_SECONDS * 1000), {
		httpOnly: true,
		sameSite: "lax",
		secure: process.env.NODE_ENV === "production",
		path: "/",
		maxAge: MAX_AGE_SECONDS,
	});
}

export async function endSession(): Promise<void> {
	(await cookies()).delete(COOKIE);
}

export async function currentUserId(): Promise<string | null> {
	return userIdFromToken((await cookies()).get(COOKIE)?.value);
}
