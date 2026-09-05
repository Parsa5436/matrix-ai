# Architecture

## Dependency direction

One direction, never the reverse:

```
app/ (routes, RSC)  →  lib/answer/  →  lib/ai/, lib/db/, lib/knowledge/
components/         →  lib/ (types only)
```

`app/` adapts HTTP and renders. It never contains a prompt string, a SQL query,
or a model call. If you are about to write `streamText` inside `app/`, stop —
it belongs in `lib/answer/`.

## Folder contract

```
app/
  (chat)/
    layout.tsx                 RTL shell, sidebar, providers
    page.tsx                   new conversation
    c/[id]/page.tsx            existing conversation (deep-linkable)
  api/
    chat/route.ts              POST → streams the pipeline. Node runtime.
    upload/route.ts            image upload → object storage
components/
  ai-elements/                 installed by the AI Elements CLI. Ours to edit.
  chat/                        composer, message list, answer card, subject picker
  ui/                          shadcn primitives
lib/
  ai/
    provider.ts                the ONLY place a model endpoint is named
    models.ts                  model roles → model ids
    schemas.ts                 Zod schemas for every structured model output
    metering.ts                token accounting
  answer/
    pipeline.ts                answer() — the contract below
    classify.ts                general vs educational, topic detection
    retrieve.ts                hybrid search, subject-filtered
    assemble.ts                persona + method card + exemplars → messages
    types.ts                   AnswerInput, AnswerChunk, AnswerResult
  knowledge/
    normalize.ts               Persian text normalization (shared, ingest + query)
    chunk.ts                   heading-aware markdown splitting
  db/
    client.ts                  Prisma singleton
    vector.ts                  the only raw-SQL file
scripts/
  ingest.ts                    CLI. Never a route — it will time out.
  eval.ts                      CLI. Calls answer() directly.
prisma/
  schema.prisma
  sql/vector-indexes.sql       idempotent, run after every migrate
evals/
  <subject>.json               question → expected answer/option
```

## The answer pipeline contract

This is the spine of the project. Keep it exactly this shape.

```ts
// lib/answer/types.ts
export type AnswerInput = {
  question: string;
  imageUrl?: string;
  subjectId: string;
  chapterId?: string;
  history: { role: "user" | "assistant"; text: string }[];
};

export type AnswerMode = "teacher" | "standard" | "general";

export type SourceRef = { kind: "note" | "book" | "exemplar"; id: string; label: string };

export type AnswerChunk =
  | { type: "mode"; mode: AnswerMode }
  | { type: "text"; delta: string }
  | { type: "sources"; sources: SourceRef[] };

export type Deps = {
  llm: LlmProvider;
  embed: EmbedProvider;
  db: PrismaClient;
};

export function answer(input: AnswerInput, deps: Deps): AsyncIterable<AnswerChunk>;
```

Why `deps` is injected rather than imported: the eval harness and any test call
`answer()` with fakes, and swapping the reseller is a new `LlmProvider`, not a
change to the pipeline.

**The seam exists from the first commit, even with one implementation and one
stage.** A module under `lib/answer/` that imports the provider directly is
architectural drift, not a shortcut — phase 3's eval harness cannot call it, and
retrofitting injection after three stages exist is strictly more work than
starting with it. If you are writing an early single-stage version, it still
takes `deps`.

Why `mode` is emitted first: the contract requires the system to say when it is
*not* using the teacher's method (clause 6). Making that an explicit field
rather than something buried in prose means the UI can show it and the eval can
score it.

### Stage order

```
classify → retrieve → assemble → generate → stream
```

Each stage is a plain function with typed input and output. Adding a reranker
means inserting one function between `retrieve` and `assemble`. Adding a subject
means data, not code.

## Message persistence

Store AI SDK's `UIMessage` parts, not flattened text:

```prisma
model Message {
  id             String   @id @default(cuid())
  conversationId String
  role           String
  parts          Json     // UIMessage["parts"]
  mode           String?  // AnswerMode, assistant messages only
  audioUrl       String?  // phase 6; the column exists from day one
  createdAt      DateTime @default(now())
}
```

`parts` covers text, images, tool calls, and citations with no migration.
`audioUrl` is null until TTS ships — adding the column now costs one line and
saves a migration on a live database later.

## Naming

- Files: `kebab-case.ts`. Components: `PascalCase.tsx`.
- Functions say what they do to what: `retrieveExemplars`, `normalizePersian`,
  `buildTeacherPrompt`. Not `handler`, `processor`, `manager`.
- Zod schemas end in `Schema`; inferred types drop it: `AnswerResultSchema` →
  `AnswerResult`.
- No `index.ts` barrels except `components/ui`. Barrels hide the dependency
  graph and slow the bundler for no reader benefit.

## What not to build

Until an eval score or a real user problem justifies it: no reranker, no queue,
no worker process, no caching layer, no feature flags, no abstract base classes,
no plugin system, no generic `Repository<T>`. This project has one team and a
deadline; every layer you add is a layer someone has to trace through later.
