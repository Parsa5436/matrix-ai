# Project facts

**This file is volatile.** Versions move faster than this document. Before
relying on any value here, check `package.json` and the lockfile. When a fact
here contradicts the installed version, the installed version wins — and update
this file in the same commit.

## Runtime and tooling

- Package manager: **Bun**. Never npm/pnpm/yarn.
- Node runtime for all API routes (`export const runtime = "nodejs"`).
- Formatter/linter: Biome. Tabs, double quotes.
- TypeScript strict, `noUnusedLocals`, `noUncheckedIndexedAccess`.

## Version-sensitive APIs

Read the official docs for the **installed** version before calling these. Their
APIs have changed across recent majors and training-data memory is unreliable:

- **AI SDK** — `streamText`, `useChat`, message/part shapes, transport config
- **`@ai-sdk/openai-compatible`** — the provider factory's return shape
- **Zod** — v4 changed error and inference behaviour
- **Prisma** — preview flags, `Unsupported()`, `$queryRaw` typing
- **Next.js** — App Router route segment config, `next/font`
- **Tailwind** — v4 config lives in CSS, not `tailwind.config.js`
- **AI Elements** — component props change; the installed source in
  `components/ai-elements/` is the truth, not the website

If you cannot find documentation for the installed version, search the web. If
you still cannot confirm it, say so and stop — do not guess an API.

## Environment variables

```
DATABASE_URL

AI_BASE_URL                  AvalAI, OpenAI-compatible
AI_API_KEY
AI_FALLBACK_BASE_URL         YaraBot
AI_FALLBACK_API_KEY

MODEL_REASONING              answer generation + vision
MODEL_FAST                   classify, extract
MODEL_EMBEDDING
EMBEDDING_DIM                must match the vector() dimension in schema.prisma

S3_ENDPOINT / S3_BUCKET / S3_KEY / S3_SECRET
SMS_API_KEY                  OTP
```

Never read `process.env` outside `lib/ai/provider.ts`, `lib/db/client.ts`, and a
single validated `lib/env.ts`. Scattered env reads are how a missing variable
becomes a runtime crash in production instead of a startup failure.

Validate all of them with Zod at boot. Fail loudly and immediately.

## Scripts

```
bun run dev
bun run typecheck
bun run lint
bun run build
bun run db:migrate       migrate diff --from-migrations -> SQL; review, then migrate deploy
bun run db:indexes       prisma db execute --file prisma/sql/vector-indexes.sql
bun run db:bootstrap     roles, databases, vector extension (superuser, once)
bun run test             bun test
bun run ingest           scripts/ingest.ts  [--activate] [--dir <path>]
bun run ingest:slides    scripts/ingest-slides.ts (the chapter-1 deck)
bun run corpus:activate  scripts/corpus-activate.ts <version>
bun run cards            scripts/method-cards.ts  — merge 66 drafts to 6, audit, write files
bun run cards --apply    load content/derived/method-cards.md, teacherApproved = true
bun run eval             scripts/eval.ts  [--build] [--ablate]
bun run review           scripts/review.ts  [--seed N] [--chrome <path>]
bun run user:add         scripts/user-add.ts <username> <password> [--cap <tokens>]
```

`db:migrate` and `db:indexes` always run as a pair. See `gotchas.md` for why.

## Deployment

App, Postgres, and object storage inside Iran. Only model and TTS calls cross
the border, via AvalAI. Postgres needs the `vector` extension enabled before the
first migration.
