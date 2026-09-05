import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// scrypt from node:crypto rather than a dependency: it is memory-hard, it is in the standard
// library of both runtimes we use, and there is no install step to fail from Iran. The
// parameters travel inside the hash so raising them later does not invalidate existing rows.

const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;

// Persian keyboards can produce two byte sequences for the same visible password, and a user
// who cannot log in from their phone has no way to tell why.
const canonical = (password: string) => password.normalize("NFKC");

export function hashPassword(password: string): string {
	const salt = randomBytes(16);
	const key = scryptSync(canonical(password), salt, KEY_LENGTH, {
		N,
		r: R,
		p: P,
	});
	return [
		"scrypt",
		N,
		R,
		P,
		salt.toString("base64"),
		key.toString("base64"),
	].join("$");
}

export function verifyPassword(password: string, stored: string): boolean {
	const [scheme, n, r, p, salt, key] = stored.split("$");
	if (scheme !== "scrypt" || !n || !r || !p || !salt || !key) return false;

	const expected = Buffer.from(key, "base64");
	const actual = scryptSync(
		canonical(password),
		Buffer.from(salt, "base64"),
		expected.length,
		{ N: Number(n), r: Number(r), p: Number(p) },
	);
	// Length-safe: timingSafeEqual throws on a mismatch rather than returning false.
	return actual.length === expected.length && timingSafeEqual(actual, expected);
}
