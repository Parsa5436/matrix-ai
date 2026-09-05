# CLAUDE.md

Persian RTL educational chatbot. A student picks a subject, asks a question or
photographs one, and gets it solved **the way their own teacher solves it**.

## Read this first, every session

**`/ostad` is the constitution.** Read it before writing any code, including
one-line changes. It contains the architecture, the non-negotiable rules, the
spec, and the phase roadmap. Its `references/` folder holds the detail — read
the file that matches the task.

If the skill and this file ever disagree, the skill wins and this file gets
fixed.

## The three rules people break most

1. **Nothing we don't own sits between us and the AI SDK.** UI comes from AI
   Elements (source lands in our repo). No wrapper libraries, no runtimes.
2. **The answer pipeline is a pure function** — `answer(input, deps)`, HTTP-free,
   with `{ llm, embed, db }` injected. Nothing under `lib/answer/` imports the
   provider directly, even in a single-stage early version.
3. **Read the docs for the installed version before calling any API.** Not
   memory. If you cannot find them, search. If you still cannot confirm, say so
   and stop.

## Language

Persian goes directly in JSX. **There is no i18n layer and we are not adding
one.** Single-locale product; a translation indirection costs a lookup at every
call site and a permanent class of missing-key bugs for flexibility nobody
asked for.

Logs and code comments stay English. Every user-facing string, including error
and empty states, is Persian.

## Commands

```
bun run dev
bun run typecheck
bun run lint
bun run build
bun run probe        # AvalAI transport checks — run before trusting the provider
bun run probe:tts    # speech: does the gateway serve it, and does it read Persian
bun run db:migrate   # always --create-only, review, then apply
bun run db:indexes   # ALWAYS runs after db:migrate. See the skill's gotchas.
bun run ingest
bun run eval
```

`db:migrate` and `db:indexes` are a pair. Prisma does not know the pgvector HNSW
index exists and will emit `DROP INDEX` for it as drift.

## Definition of done

A task is finished when it reports:

- what changed
- what was deliberately **not** built, and why
- anything that could not be verified
- the verification commands actually run, with their results
- for any change to prompts, retrieval, or models: the **eval score delta**

"It compiles" is not done. A pipeline change without an eval number is a guess.

## Things that fail silently here

Listed in full in the skill's `references/gotchas.md`. The short version: a
dropped vector index, divergent Persian normalization, missing embedding
prefixes, `next/font/google` in a build that runs from Iran, and reseller
capabilities that exist upstream but not at the gateway. None of these throw.
All of them make the product worse. Check them explicitly rather than assuming.

## Current phase

**Phase 1 — Foundation.** See `references/roadmap.md` in the skill. Do not start
phase 2 work until the phase 1 gate passes: a Persian message returns a streamed
Persian answer, all four probes pass, and typecheck/lint/build are clean.
