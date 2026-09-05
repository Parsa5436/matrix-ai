import { defineConfig, env } from "prisma/config";

// Prisma 7 no longer loads .env itself. Node's own loader avoids a dotenv dependency.
try {
	process.loadEnvFile();
} catch {
	// No .env — the CLI will fail on a missing DATABASE_URL, which is the point.
}

// The shadow database is dev-only scratch that `migrate dev` wipes and replays into. It is
// reached as the superuser, not the app role, because the replay has to CREATE EXTENSION and
// that needs rights the application must never carry. `migrate deploy` uses no shadow
// database at all, so production still connects only as ostad_app.
const shadowUrl = (() => {
	const app = process.env.DATABASE_URL;
	const superuser = process.env.DATABASE_SUPERUSER_URL;
	if (!app || !superuser) return undefined;
	const url = new URL(superuser);
	url.pathname = `${new URL(app).pathname}_shadow`;
	url.search = new URL(app).search;
	return url.toString();
})();

export default defineConfig({
	schema: "prisma/schema.prisma",
	// `initShadowDb` is gated behind this flag in Prisma 7. It only affects the dev-time
	// shadow database; nothing about the runtime client is experimental.
	experimental: { externalTables: true },
	migrations: {
		path: "prisma/migrations",
		// `migrate dev` resets the shadow database before replaying, which drops the vector
		// extension `bun run db:bootstrap` put there — and migration 1 then fails on
		// `vector(768)` with "type does not exist". This runs after each reset, so the
		// extension is back before any migration references it.
		initShadowDb: "CREATE EXTENSION IF NOT EXISTS vector;",
	},
	datasource: {
		url: env("DATABASE_URL"),
		shadowDatabaseUrl: shadowUrl,
	},
});
