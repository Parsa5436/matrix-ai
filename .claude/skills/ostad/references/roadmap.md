# Ostad — Roadmap

Six phases. Each ends with something demonstrable and a gate that must pass
before the next phase starts. If a gate fails, fix it — do not carry the debt
forward. That is the only rule that keeps a six-phase plan from becoming a
twelve-phase one.

---

## The standing prompt

Prefix every task with this. Replace the DiceX-style prompt entirely — no
`apple-design` (this product's UI is a chat surface, not a design showcase), and
`ponytail` at `full`, never `ultra`.

```
/ostad /ponytail:ponytail

You are a lazy senior engineer. You dislike long, clever, or unusual code and
always choose the simplest solution that actually works. You reach for a good
library where it removes real complexity, and you write ten lines yourself where
a library would be overkill.

You keep the documentation open. You never write an API call from memory, even
when you are confident you remember it — you read the official docs for the
installed version first, and if you cannot find them, you search the web. If you
still cannot confirm the API, you say so and stop rather than guessing.

Before writing code:
- Read the ostad skill: architecture, conventions, and the non-negotiable rules.
- Read the reference file in the skill that matches this task.
- Read the closest existing module in the repo and match its shape exactly.

While writing code:
- No nested prop drilling, no comments restating the code, no types that only
  echo the shape below them, no abstraction with one caller.
- If the surrounding code was written badly, refactor it to the documented
  pattern rather than matching its mistakes — and say what you changed and why.
- If our current approach or a chosen library is genuinely worse than something
  you find, say so with trade-offs and ask before switching. Do not swap
  silently in either direction.

When you are done, report: what you changed, what you deliberately did not
build, anything you could not verify, and the verification commands you ran.

Task:
```

Add `/graft` from phase 4 onward, once there is a codebase worth graphing.
On an empty repo it has nothing to work with.

---

## Phase 1 — Foundation

**Goal:** a Persian RTL chat that streams a real answer from Gemini through
AvalAI, deployed nowhere yet but running end to end locally.

- Scaffold: Next.js + TypeScript + Tailwind + shadcn + AI Elements + Prisma +
  Biome, with Bun
- `lib/env.ts` — Zod-validated environment, fails loudly at boot
- `lib/ai/provider.ts` and `lib/ai/models.ts` — AvalAI, model roles, retry,
  fallback stub
- `app/api/chat/route.ts` — Node runtime, streams
- RTL shell: `dir="rtl"`, Vazirmatn, logical properties, KaTeX CSS
- Postgres running locally with the `vector` extension, empty schema migrated
- `db:migrate` + `db:indexes` script pair wired

**Gate:** send a Persian message, see a streamed Persian answer. Record
time-to-first-token from the target network. `typecheck`, `lint`, `build` clean.

**Also in this phase, before writing much code — the four probes.** Each one
changes the architecture if it fails, so run them on the real AvalAI account
first: does image input proxy through; does streaming arrive as SSE; is
`response_format` honoured; which embedding endpoint exists and what is its
dimension.

---

## Phase 2 — Knowledge base

**Goal:** one subject fully ingested, queryable, and verified.

- Full Prisma schema (subjects, teachers, chapters, topics, chunks, exemplars,
  method cards) with `corpusVersion` everywhere
- `lib/knowledge/normalize.ts` — the shared Persian normalizer
- `scripts/ingest.ts` — validate formulas, split, extract to structured records,
  normalize, embed, insert
- Method cards drafted for one subject and sent to the teacher for approval
- `lib/db/vector.ts` — the only raw-SQL file

**Gate:** ingest reports counts (written, flagged, formulas failing to compile).
A manual query returns sensible exemplars for a known topic. Re-running ingest
creates a new version without touching the old one.

---

## Phase 3 — The answer pipeline

**Goal:** the product actually works, for one subject.

- `lib/answer/` — classify, retrieve, assemble, pipeline, types
- Structured answer output: mode, correct option, steps, sources
- Prompt assembly: persona + method card + retrieved exemplars
- `evals/<subject>.json` with 50–100 questions, and `scripts/eval.ts`
- Iterate prompts and retrieval against the eval score

**Gate:** the eval hits the agreed accuracy threshold. `answer()` runs from the
eval script with no HTTP. Every subsequent pipeline change reports a delta.

---

## Phase 4 — Chat product

**Goal:** a real application rather than a demo.

- Conversation and message persistence, `UIMessage` parts in JSONB
- History sidebar, deep-linkable conversations
- OTP SMS authentication
- Subject and chapter selector wired into the pipeline
- Answer card UI: mode badge, correct option, steps, citations
- Metering and per-user daily quota

**Gate:** two users cannot see each other's conversations. Refreshing preserves
state. Quota blocks at the provider boundary, not in the UI.

---

## Phase 5 — Vision

**Goal:** photograph a question, get it solved.

- Client-side compression and upload to object storage
- Extraction pass: question, options, formulas to LaTeX
- Original image retained in the final generation call
- Image-aware eval cases added

**Gate:** a photographed question from each subject is answered correctly, and
the eval score does not regress on text-only cases.

---

## Phase 6 — Scale and harden

**Goal:** all subjects live, deployable, and observable.

- Remaining subjects ingested through the existing pipeline — data, not code
- Standard Persian TTS: text preparation function, generation on click, cached
  by content hash, `audioUrl` populated
- Fallback provider wired and tested by disabling the primary
- Rate limits, structured logging, error tracking
- Deploy to the Iranian host; verify streaming through the real proxy

**Gate:** every subject passes its eval. Killing the primary provider degrades
to the fallback. Time-to-first-token measured in production is acceptable.

---

## Standing rules across all phases

- No phase starts before the previous gate passes.
- Any pipeline change reports an eval delta.
- Anything that cannot be verified is reported as unverified, never assumed.
- Scope added mid-phase gets written down and scheduled, not absorbed silently.
