// One-time setup, run as a superuser. Creates the application role, its database and the
// vector extension — the three things the application itself must never be able to do.
//
// DATABASE_SUPERUSER_URL is a setup-time variable: it is deliberately absent from
// lib/env.ts so the running app has no way to reach it.

import { SQL } from "bun";

const superuserUrl = process.env.DATABASE_SUPERUSER_URL;
const appUrl = process.env.DATABASE_URL;

if (!superuserUrl || !appUrl) {
	console.error(
		"Set DATABASE_SUPERUSER_URL and DATABASE_URL in .env (see .env.example).",
	);
	process.exit(1);
}

const app = new URL(appUrl);
const role = decodeURIComponent(app.username);
const password = decodeURIComponent(app.password);
const database = app.pathname.slice(1);

if (!role || !password || !database) {
	console.error(
		`DATABASE_URL must carry a user, password and database name. Got: ${app.protocol}//${role || "?"}:***@${app.host}/${database || "?"}`,
	);
	process.exit(1);
}

// format() does the identifier and literal escaping inside Postgres rather than by
// string concatenation here, which is the only safe way to put a name into DDL.
// The ::text casts are required: format() is variadic "any", so without them the
// server cannot infer a parameter's type and rejects the query outright.
const ddl = async (sql: SQL, query: Promise<unknown>) => {
	const rows = (await query) as { ddl: string }[];
	const statement = rows[0]?.ddl;
	if (!statement) throw new Error("format() returned no statement");
	await sql.unsafe(statement);
	return statement;
};

const admin = new SQL(superuserUrl);

const roleExists =
	(await admin`SELECT 1 FROM pg_roles WHERE rolname = ${role}`) as unknown[];
if (roleExists.length) {
	console.log(`role ${role} already exists`);
} else {
	await ddl(
		admin,
		admin`SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', ${role}::text, ${password}::text) AS ddl`,
	);
	console.log(`created role ${role}`);
}

const dbExists =
	(await admin`SELECT 1 FROM pg_database WHERE datname = ${database}`) as unknown[];
if (dbExists.length) {
	console.log(`database ${database} already exists`);
} else {
	await ddl(
		admin,
		admin`SELECT format('CREATE DATABASE %I OWNER %I', ${database}::text, ${role}::text) AS ddl`,
	);
	console.log(`created database ${database}`);
}

// `prisma migrate dev` diffs against a throwaway "shadow" database. Left to itself it
// creates and drops one, which needs CREATEDB — a privilege the application must never
// carry. Creating it here, owned by the app role, keeps migrate working and the role
// minimal. It holds no data; Prisma resets its schema on every run.
const shadow = `${database}_shadow`;
const shadowExists =
	(await admin`SELECT 1 FROM pg_database WHERE datname = ${shadow}`) as unknown[];
if (shadowExists.length) {
	console.log(`shadow database ${shadow} already exists`);
} else {
	await ddl(
		admin,
		admin`SELECT format('CREATE DATABASE %I OWNER %I', ${shadow}::text, ${role}::text) AS ddl`,
	);
	console.log(`created shadow database ${shadow}`);
}

await admin.close();

// CREATE EXTENSION has to run inside the target database, still as the superuser.
const target = new URL(superuserUrl);
target.pathname = `/${database}`;
const db = new SQL(target.toString());

await db`CREATE EXTENSION IF NOT EXISTS vector`;
// Postgres 15+ no longer lets non-owners create in public, and Prisma migrations need to.
await ddl(
	db,
	db`SELECT format('GRANT CREATE, USAGE ON SCHEMA public TO %I', ${role}::text) AS ddl`,
);

// migrate replays every migration into the shadow database, so it needs the same
// extension and the same schema rights as the real one.
const shadowUrl = new URL(superuserUrl);
shadowUrl.pathname = `/${shadow}`;
const shadowDb = new SQL(shadowUrl.toString());
await shadowDb`CREATE EXTENSION IF NOT EXISTS vector`;
await ddl(
	shadowDb,
	shadowDb`SELECT format('GRANT CREATE, USAGE ON SCHEMA public TO %I', ${role}::text) AS ddl`,
);
await shadowDb.close();

const [version] =
	(await db`SELECT extversion FROM pg_extension WHERE extname = 'vector'`) as {
		extversion: string;
	}[];
console.log(
	`pgvector ${version?.extversion} ready in ${database} and ${shadow}, granted to ${role}`,
);

await db.close();
