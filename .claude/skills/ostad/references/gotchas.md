# Gotchas

Sharp edges that have a common property: they fail **silently**. Nothing throws,
nothing logs, and the product just gets worse.

## Prisma drops the pgvector index

Prisma does not know the `vector` type or the HNSW index. On the next
`prisma migrate dev` it sees the index as drift and emits `DROP INDEX`. Apply
that and retrieval falls back to a sequential scan — no error, just slower and
worse, discovered weeks later.

Defence, all three parts:

1. Index creation lives in `prisma/sql/vector-indexes.sql`, idempotent
   (`CREATE INDEX IF NOT EXISTS`), outside migrations.
2. `db:indexes` runs after every `db:migrate`.
3. Always `migrate dev --create-only`, read the generated SQL for `DROP INDEX`
   before applying.

**Point 3 stopped working once the index existed.** `migrate dev` refuses to
diff at all — it reports the HNSW index as drift and demands
`prisma migrate reset`, which drops the corpus. There is nothing to read,
because it will not generate anything. Diff the migration history against the
schema instead, which never inspects the live database:

```
prisma migrate diff --from-migrations prisma/migrations   --to-schema prisma/schema.prisma --script > <new-migration>/migration.sql
prisma migrate deploy
bun run db:indexes
```

That is what `bun run db:migrate` now does. Read the SQL for `DROP` before
applying it — the reason for the rule has not changed, only the command.

## The shadow database loses the vector extension

`migrate dev` (and `migrate diff --from-migrations`) resets the shadow database
before replaying, which drops `public` and the `vector` extension inside it.
Migration 1 then fails on `vector(768)` with `type "vector" does not exist`.
`db:bootstrap` creating the extension does not survive, because the reset
happens after it.

Two parts, both in `prisma.config.ts`:

- `migrations.initShadowDb: "CREATE EXTENSION IF NOT EXISTS vector;"` — runs
  after every reset. It needs `experimental: { externalTables: true }` in
  Prisma 7 or the config throws.
- `shadowDatabaseUrl` points at the superuser, because `CREATE EXTENSION` needs
  rights the app role must not have. This is dev-only: `migrate deploy` uses no
  shadow database, so production still connects only as the app role.

## Edge runtime breaks chat

`pg` needs TCP; long streams need a long-lived process. Both fail on Edge, and
the failure is confusing rather than obvious. Every route touching the database
or streaming sets `runtime = "nodejs"`.

## Buffering proxies kill streaming

Any proxy between the app and the client that buffers responses destroys the
streaming UX while appearing to work. On nginx: `proxy_buffering off` and a long
`proxy_read_timeout`. Test time-to-first-token through the real deployment, not
just locally.

## Embedding prefixes

E5-family models expect `query: ` and `passage: `. Omit them and retrieval
quality drops with no error anywhere. Confirm what the configured model expects
before writing the embed call.

## Divergent normalization

If ingest and query normalize differently — even by one rule — recall collapses
and nothing reports it. One shared function, imported by both. Never inline a
`.replace()` at a call site.

## Reseller behaviour is not upstream behaviour

Verify against AvalAI's actual responses, not Google's docs:

- Does image input actually proxy through?
- Does streaming arrive as SSE?
- Is `response_format` honoured? (Assume no — see `ai-layer.md`.)
- Which model ids actually exist? Resellers lag upstream.

A capability that exists upstream but not at the gateway fails as a confident
wrong answer, not an exception.

## Flat message storage

Storing `content: string` works until the first image, citation, or audio URL —
then it is a data migration on a live database. Store `UIMessage` parts as
JSONB from the first commit.

## Vercel-coupled code

Snippets and templates found online often assume Vercel: Neon's serverless
driver, Vercel Blob, AI Gateway, `@vercel/functions`. None of these work in our
deployment. When copying a pattern, strip the Vercel primitives first — do not
install a package to make a copied snippet compile.

## Truncating the corpus

Never `TRUNCATE` and re-ingest. Write a new `corpusVersion` and flip the
pointer. Truncation breaks live conversations and makes rollback impossible.

## Silent formula corruption

OCR and cleanup models produce LaTeX that is valid but wrong. Nothing catches
this downstream — the model reads the broken formula and answers it correctly,
which is worse than erroring. Validate at ingest by compiling every formula, and
spot-check a sample against the source PDF.

## Build-time downloads fail from Iran

`next/font/google` fetches fonts at **build** time, not runtime — the app builds
fine on a foreign CI and fails on the target host. Self-host fonts with
`next/font/local`. The same applies to any dependency that downloads an asset
during install or build: check before adding it, because the failure appears
only on the machine that matters.

## Superuser database URLs

`CREATE EXTENSION vector` needs elevated rights once. The application does not.
Running the app on a superuser connection because it was convenient during setup
is how a SQL injection becomes a full database compromise. Separate the two.

## Windows CRLF

If working on Windows, prefer `biome lint` over `biome format` to avoid phantom
line-ending diffs across the whole tree.
