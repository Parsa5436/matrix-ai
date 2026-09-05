---
name: ostad
description: Engineering constitution for Ostad — a Persian, RTL educational chatbot built on Next.js + AI SDK + Gemini (via AvalAI) + Postgres/pgvector, which answers students' questions using their own teacher's solving method. Read this skill before writing, reviewing, or refactoring ANY code in this repository — including "quick" one-line changes, a single component, a schema edit, a prompt tweak, or a config file. Use it whenever the task touches the chat UI, the answer pipeline, retrieval, method cards, exemplars, ingestion, image/vision input, TTS, RTL or Persian text, Prisma or pgvector, or the AvalAI provider. If you are unsure whether this skill applies, it applies.
---

# Ostad Engineering Constitution

You are building a Persian educational chatbot. A student uploads a photo of a
test question or types it; the system answers **in the way their own teacher
solves it**, using the teacher's notes as the source of truth, and later reads
the answer aloud.

Two things make this project different from a generic chat app, and almost every
rule below exists because of one of them:

1. **The differentiator is the answer pipeline, not the UI.** The chat shell is a
   solved problem. What determines whether this product is good is whether the
   retrieval and prompt-assembly layer reliably reproduces the teacher's method.
2. **It runs from inside Iran.** International egress is a dependency, not an
   assumption. Every outbound call is a thing that can fail.

This file is the constitution. Detail lives in `references/` — pull them in as
the workflow tells you to. If you find yourself writing long, repetitive code,
stop; that is the exact failure mode this skill exists to prevent.

## The seven principles

**1 — Own everything between you and the AI SDK.** No runtime, wrapper, or
abstraction layer sits between our code and `useChat`/`streamText` unless we
wrote it. UI comes from AI Elements (shadcn registry — the source lands in our
repo). This is the single rule that keeps us from getting stuck later, because
no upstream release can break code we own.

**2 — The answer pipeline is a pure function.** `answer(input, deps)` returns an
async iterable and lives outside the route handler, with `{ llm, embed, db }`
injected. If you cannot call it from a test script without HTTP, you have broken
the architecture. Everything downstream — swapping providers, adding a reranker,
adding a subject, adding TTS — is then a change inside one stage.

**3 — Minimum complexity, maximum readability.** Fewest lines, fewest concepts.
No premature abstraction, no generics nobody reads, no types that only restate
the shape below them, no comments explaining what the code already says. A
newcomer should understand any module in under 10 minutes.

**4 — One handwriting.** Every module shares the same shape; only the content
differs. A reader must always be able to point and say "fetch happens here,
transform here, validate here, render there." New code imitates the existing
idiom, never your personal style.

**5 — Read before you write (hard gate).** Before using any library API, read
the official docs for the installed version. Coding from memory is how stale and
wrong patterns get in — the versions here move fast and your training data is
older than the lockfile. If you cannot find the documentation, search the web.
If you still cannot confirm it, say so instead of guessing. See
`references/project-facts.md` for what is version-sensitive.

**6 — Propose the better option.** If an existing approach in this repo, or a
library we chose, is genuinely worse than something your research found, say so
with trade-offs and ask. Don't silently follow the old way, and don't silently
swap in the new one either. If you touch code whose neighbours were written
badly, refactor them to the documented pattern rather than matching their
mistakes — but say what you refactored and why.

**7 — Boring on purpose.** The output should read like senior production work,
not a tutorial. Honest about gaps, defensive at boundaries, unexciting to read.

## Mandatory workflow

Skipping discovery is the most common way to produce code that "works" but
doesn't belong.

**1 — Discovery (the hard gate).** Find the closest existing module and make it
your template. Read it end to end. Read the reference file that matches the
task (see the map at the bottom). Read the official docs for every
version-sensitive API you are about to call. For anything AI-provider-related,
confirm the behaviour against AvalAI's actual response, not the upstream
vendor's docs — see `references/ai-layer.md`.

**2 — Plan.** State: which layer the code belongs in, the folder contract, the
Zod schemas, the DB access path. Resolve open questions with the
user now, not mid-implementation. If the plan needs a new dependency, justify it
against what is already installed.

**3 — Implement.** Mirror the reference module file-for-file. Fetch and
transform in the server layer; render in components; validate at every boundary
with Zod. Write the least code that satisfies the contract.

**4 — Verify.** `bun run typecheck`, `bun run lint`, `bun run build`. For
anything touching the answer pipeline, run the eval harness
(`bun run eval`) and report the score delta — a pipeline change without an eval
number is not finished. Then apply the 10-minute test: if a newcomer couldn't
trace input→retrieve→assemble→generate→render quickly, simplify.

## Non-negotiable rules

Each rule is one idea with its reason. Detail lives in the referenced file.

**Bun only** — never npm/pnpm/yarn. One lockfile, one resolver.
→ `project-facts.md`

**Every model call goes through `lib/ai/provider.ts`** — never import a vendor
SDK or call `fetch` against a model endpoint directly. The provider owns the
base URL, the API key, retries, failover to the backup reseller, and usage
metering. A direct call bypasses all four. → `ai-layer.md`

**Never depend on native structured output.** Resellers may not proxy
`response_format`. Prompt for JSON, parse, validate with Zod, retry once on
failure. This is the documented idiom; do not "improve" it into a
`json_schema` call. → `ai-layer.md`

**The answer pipeline lives in `lib/answer/` and is HTTP-free.** Route handlers
adapt HTTP to the pipeline and stream the result. No retrieval, no prompt
strings, and no model calls inside `app/`. → `architecture.md`

**Retrieval always filters by subject.** An unfiltered vector search across a
multi-subject corpus returns a confidently wrong answer from the wrong course.
The subject comes from the UI selector, not from model inference.
→ `rag-contract.md`

**Messages are stored as `UIMessage` parts in JSONB, never as flat text.**
Images, citations, and audio arrive later; a `content: string` column forces a
data migration when they do. → `architecture.md`

**Chunks and exemplars carry `corpusVersion`; retrieval filters on the active
version.** Re-ingesting writes a new version and flips a pointer, so a mid-term
notes update is not an outage and rollback is one UPDATE. → `rag-contract.md`

**pgvector columns are `Unsupported()` in Prisma and their indexes live in a
separate idempotent SQL file.** Prisma does not know the HNSW index exists and
will emit `DROP INDEX` for it as drift; losing it degrades retrieval silently,
with no error. → `gotchas.md`

**Vector reads return ids and scores from raw SQL; rows are hydrated through
Prisma.** This confines hand-written SQL to one small function and keeps the
rest of the codebase typed. → `rag-contract.md`

**Write Persian directly in JSX. There is no i18n layer.** This product ships in
one language. A translation indirection buys nothing here and costs a key
namespace, a lookup at every call site, and a whole class of missing-key bugs.
If a second locale is ever funded, extracting strings is a mechanical refactor —
carrying the abstraction for months in advance is not. Numbers, URLs, code, and
LaTeX still need `dir="ltr"` inside RTL prose. → `rtl-persian.md`

**Tailwind uses logical properties only** — `ms-`/`me-`/`ps-`/`pe-`/`start-`/
`end-`, never `ml-`/`mr-`/`pl-`/`pr-`/`left-`/`right-`. Retrofitting RTL later
costs days; writing it correctly costs nothing. → `rtl-persian.md`

**Persian text is normalized by one shared function, applied identically at
ingest and at query time.** Divergent normalization silently destroys recall and
produces no error anywhere. → `rtl-persian.md`

**Fonts, icons, and any build-time asset are self-hosted.** `next/font/google`
fetches at *build* time, so a build from inside Iran fails on it. The same trap
applies to any package that downloads during install or build.
→ `gotchas.md`

**The app's database role is not a superuser.** `CREATE EXTENSION vector` needs
elevated rights once; the application connection does not. Keep them separate.

**Chat routes run on the Node runtime, never Edge.** `pg` and long-lived
streaming do not work on Edge. → `gotchas.md`

**TypeScript strict, no `any`.** Model unknowns as `unknown` and narrow at the
boundary.

**Every model call records tokens against the user.** Third-party cost is the
client's responsibility per contract; without a counter we can neither bill it
nor stop abuse. → `ai-layer.md`

## Decision points

**New file vs. extend existing.** Default to extending. Create a new module only
when the concern is genuinely separate. Two similar things do not justify an
abstraction; three might.

**Where shared code goes.** Used by one feature → keep it inside that feature.
Used by two → `lib/`. Never pre-promote on the first consumer.

**Server Component vs Client Component.** Server by default. Push `"use client"`
as far down the tree as possible — a page can fetch on the server and hand data
to a small interactive leaf. Do not mark a page client because one button needs
`onClick`.

**New dependency.** Ask first: is it in the standard library, in Next.js, in
something already installed, or a one-liner? Reach for a dependency when it
removes real complexity, not to avoid writing ten lines. But do not hand-roll
eighty lines of markup to re-create a component AI Elements already ships.

**Reranker, caching, queues, workers.** Not until the eval harness shows they
are needed. Measure, then add.

## Reference map

Read the file that matches the task. Don't load them all up front.

| File | Read it when… |
| --- | --- |
| `references/spec.md` | Starting any task — what we are building, scope, constraints, acceptance criteria, and how each contract clause maps to a phase. Read this first if you have no other context. |
| `references/roadmap.md` | Starting or finishing a phase — the six phases, what belongs in each, and the gate that must pass before the next one opens. |
| `references/architecture.md` | Building or refactoring any module — folder contract, layer boundaries, the `answer()` contract, message persistence shape. |
| `references/ai-layer.md` | Anything that calls a model — provider setup, AvalAI, model roles, streaming, structured output, vision, metering. |
| `references/rag-contract.md` | Knowledge base work — the three knowledge layers, Prisma schema, ingestion CLI, retrieval, corpus versioning, evals. |
| `references/rtl-persian.md` | Any user-facing text — RTL rules, fonts, normalization, LaTeX rendering, TTS text preparation. |
| `references/project-facts.md` | Needing versions, env vars, scripts, ports. **Volatile — verify against the live lockfile before relying on a value.** |
| `references/gotchas.md` | Hitting a sharp edge — Prisma/pgvector index drops, Edge runtime, reseller quirks, embedding prefixes, streaming buffers. |
