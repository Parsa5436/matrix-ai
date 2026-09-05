import { describe, expect, test } from "bun:test";
import { hashPassword, verifyPassword } from "./password";
import { sessionToken, userIdFromToken } from "./session";

// The cookie is the only thing standing between two students' conversations, and it is not
// stored anywhere — its integrity is entirely the signature. These cover the ways a forged
// or stale one could be accepted.

const HOUR = 60 * 60 * 1000;

describe("session token", () => {
	test("round-trips the user id", () => {
		const token = sessionToken("user-1", Date.now() + HOUR);
		expect(userIdFromToken(token)).toBe("user-1");
	});

	test("rejects an expired token", () => {
		expect(userIdFromToken(sessionToken("user-1", Date.now() - 1))).toBeNull();
	});

	test("rejects a token whose user id was swapped", () => {
		const token = sessionToken("user-1", Date.now() + HOUR);
		const forged = token.replace("user-1", "user-2");
		expect(userIdFromToken(forged)).toBeNull();
	});

	test("rejects a token whose expiry was extended", () => {
		const expired = sessionToken("user-1", Date.now() - 1);
		const [id, , signature] = expired.split(".");
		expect(
			userIdFromToken(`${id}.${Date.now() + HOUR}.${signature}`),
		).toBeNull();
	});

	test("rejects nonsense", () => {
		for (const token of [undefined, "", "abc", "a.b", "user-1.999999999999."])
			expect(userIdFromToken(token)).toBeNull();
	});
});

describe("password hashing", () => {
	test("verifies the right password and rejects the wrong one", () => {
		const stored = hashPassword("گذرواژه-۱۲۳۴");
		expect(verifyPassword("گذرواژه-۱۲۳۴", stored)).toBe(true);
		expect(verifyPassword("گذرواژه-۱۲۳۵", stored)).toBe(false);
	});

	test("salts, so the same password hashes differently every time", () => {
		expect(hashPassword("same-password")).not.toBe(
			hashPassword("same-password"),
		);
	});

	test("rejects a malformed stored hash instead of throwing", () => {
		expect(verifyPassword("anything", "not-a-hash")).toBe(false);
		expect(verifyPassword("anything", "")).toBe(false);
	});
});
