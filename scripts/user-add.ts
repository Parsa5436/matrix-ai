// Create a user. There is no sign-up flow in the MVP, so this is how accounts exist.
//
//   bun run user:add <username> <password> [--cap 200000]

import { hashPassword } from "@/lib/auth/password";
import { prisma } from "@/lib/db/client";

const [username, password] = process.argv
	.slice(2)
	.filter((a) => !a.startsWith("--"));
const capIndex = process.argv.indexOf("--cap");
const cap = capIndex > 0 ? Number(process.argv[capIndex + 1]) : undefined;

if (!username || !password) {
	console.error(
		"usage: bun run user:add <username> <password> [--cap <tokens>]",
	);
	process.exit(1);
}
if (password.length < 8) {
	console.error("password must be at least 8 characters");
	process.exit(1);
}

const user = await prisma.user.upsert({
	where: { username },
	create: {
		username,
		passwordHash: hashPassword(password),
		...(cap ? { dailyTokenCap: cap } : {}),
	},
	// Re-running with a new password is the only password reset there is.
	update: {
		passwordHash: hashPassword(password),
		...(cap ? { dailyTokenCap: cap } : {}),
	},
	select: { id: true, username: true, dailyTokenCap: true },
});

console.log(
	`user ${user.username} (${user.id}) cap ${user.dailyTokenCap} tokens/day`,
);
await prisma.$disconnect();
