# Ostad · استاد

A Persian, right-to-left tutoring chatbot for Iranian secondary-school physics. A student
picks a subject, types a question or photographs one out of a test booklet, and gets it worked
out **the way their own teacher solves it** — from that teacher's own notes and worked
examples, in his order, with his shortcuts, and optionally read aloud in Persian.

The interesting part is not the chat window. It is the honesty machinery around it: an answer
carries the badge **روش استاد** only when the teacher's approved material actually reached the
model, and there is a test that fails if those two ever disagree.

```
Next.js 16 · React 19 · AI SDK v7 · Gemini via an OpenAI-compatible gateway
PostgreSQL 16 + pgvector · Prisma 7 · Tailwind v4 · Bun
```

---

## How an answer is produced

```
read photo → condense → classify → retrieve → assemble → generate → stream
```

`answer(input, deps)` in [`lib/answer/pipeline.ts`](lib/answer/pipeline.ts) is an async
generator with `{ llm, embed, db }` injected. It is HTTP-free on purpose: the eval harness and
`bun run check:seam` run the whole pipeline against fakes, with no server and no database.

| Stage | What it does |
| --- | --- |
| **read photo** | a vision pass transcribes the photographed question so retrieval has words to search — the original image still goes to the final call, because a transcript cannot carry a graph's shape |
| **condense** | rewrites a follow-up into a standalone question, *for retrieval only*. «حالا اگر جرم دو برابر شود؟» has no physics nouns in it and embeds near nothing |
| **classify** | routes to coursework or chit-chat, and picks a topic. An unconfident topic is dropped rather than used — a wrong filter hides the very examples that would have answered |
| **retrieve** | hybrid search (pgvector HNSW + Postgres full-text, fused by reciprocal rank), always filtered by subject and by the active corpus version |
| **assemble** | teacher persona → approved method card → 2–4 of his worked examples → the question |
| **generate** | streams Persian with LaTeX; the badge and the citations stream as typed data parts |

### Three ideas the rest of the code exists to protect

**The badge is a claim, and it is checked.** `mode: "teacher"` is emitted only when an approved
method card or the teacher's own exemplars are in the prompt.
[`mode-honesty.test.ts`](lib/answer/mode-honesty.test.ts) asserts the *equivalence* in both
directions across the whole pipeline, so a future code path cannot start claiming it for free.

**A machine-drafted method card is not the teacher's method.** Cards are drafted from his
slides by a model, then audited claim-by-claim against his own source, and only a human flip
of `teacherApproved` lets one into a prompt. An early audit found 42 ungrounded claims,
including advice that contradicted his own rule.

**The corpus is versioned, never overwritten.** Ingest writes a new `corpusVersion` beside the
live one and a single `UPDATE` flips the pointer. A mid-term re-ingest is not an outage, and
rollback is one row.

---

## Setup

Requires [Bun](https://bun.sh) and PostgreSQL with the `vector` extension.

```bash
bun install
cp .env.example .env      # then fill in the real values
bun run probe             # verify the gateway before anything else
bun run db:bootstrap      # once, as a superuser: role + database + vector extension
bun run db:apply          # apply prisma/migrations
bun run db:indexes        # re-create the pgvector indexes Prisma does not know about
bun run ingest            # build a corpus version from your own content
bun run user:add          # there is no signup; users are created here
bun run dev
```

Two database URLs, on purpose. `DATABASE_SUPERUSER_URL` exists only for `db:bootstrap`, which
creates the extension, the application role and the shadow database Prisma needs;
`DATABASE_URL` is the unprivileged connection the app runs on and the only one
[`lib/env.ts`](lib/env.ts) validates.

> **The corpus is not in this repository.** The teacher's slide deck and booklets are his
> commercial material. `content/` is git-ignored; point `bun run ingest --dir` at your own.

### Changing the schema

`db:migrate` **prints** the SQL that would take `prisma/migrations` to `schema.prisma`. It does
not write or apply anything — read it first, then save it yourself:

```bash
mkdir -p prisma/migrations/$(date +%Y%m%d%H%M%S)_your_change
bun run db:migrate > prisma/migrations/*_your_change/migration.sql
bun run db:apply
bun run db:indexes        # ALWAYS. See below.
bun run db:generate
```

`db:apply` and `db:indexes` are a pair. Prisma does not know the pgvector HNSW indexes exist
and emits `DROP INDEX` for them as drift; losing one degrades retrieval silently, with no error
anywhere. [`prisma/sql/vector-indexes.sql`](prisma/sql/vector-indexes.sql) re-creates them
idempotently.

---

## Deploying

A plain Node server on a box you control. Not `output: "standalone"` — the server needs a
checkout anyway for `db:apply`, `db:indexes` and `user:add`, so the standalone bundle would be
a second artefact buying nothing.

**The corpus does not come with the code.** A fresh database means no exemplars and no approved
method cards, so every answer silently falls back to روش استاندارد — the product without the
thing that makes it the product. Move the database, do not re-ingest: re-ingesting costs model
calls *and* drops `teacherApproved`, which only the teacher can restore.

```bash
pg_dump --no-owner --no-privileges "$DATABASE_URL" > ostad.sql   # workstation
psql "$DATABASE_URL" < ostad.sql && bun run db:indexes            # server
```

The server needs **PostgreSQL with the `vector` extension** (not just Postgres), **Bun**, and a
TLS terminator in front. `.env` there differs from a workstation in four places:

| | |
| --- | --- |
| `SESSION_SECRET` | **a new one.** `openssl rand -base64 32`. Reusing the dev secret means a dev cookie authenticates against production |
| `DATABASE_URL` | the production role, still not a superuser |
| `UPLOAD_DIR` | an absolute path **outside the checkout** — uploads and generated audio live here and a redeploy must not wipe them |
| `AI_BASE_URL` | run `bun run probe` **on the server**; egress is a dependency, not an assumption |

**No inline comments in the server's `.env`.** A shell sourcing the file drops ` # …` from the
end of a value; systemd's `EnvironmentFile` keeps it. A commented line copied from a
workstation therefore works in every script you test with and fails only in the service, with
`Header 'Authorization' has invalid value`. Strip them:

```bash
sed -E -i 's/[[:space:]]+#.*$//' /srv/ostad/.env
```

Nothing in `content/` is read at runtime, so the corpus sources can stay off the server.

---

## Scripts

| Script | What it does |
| --- | --- |
| `dev` · `build` · `start` | Next.js |
| `typecheck` · `lint` · `format` | `tsc --noEmit`, Biome check, Biome check --write |
| `test` | unit tests — see below |
| `probe` | gateway capability checks: model list, SSE framing, image passthrough, embedding width |
| `probe:tts` | does the gateway serve a speech model, and does it read Persian |
| `check:seam` | proves `lib/answer/` runs on a fake llm — no provider, no HTTP |
| `check:prompts` | proves no prompt lost or doubled a LaTeX backslash |
| `db:bootstrap` | one-time superuser setup: role, database, shadow database, `vector` |
| `db:migrate` · `db:apply` · `db:indexes` · `db:generate` | see "Changing the schema" |
| `ingest` | Markdown notes → a new corpus version (`--activate`, `--dir`) |
| `ingest:slides` | a slide deck → the same corpus, via a vision model |
| `deck:build` | pick the ink-richest copy of each slide and rasterise it for the ingest |
| `cards` | draft, audit and merge method cards from the ingested material |
| `review` | render an HTML sheet of exemplars for the teacher to approve |
| `trace:ink` | trace his handwriting off a slide into the login page's SVG paths |
| `corpus:activate <n>` | make corpus version `n` live |
| `eval` · `eval:vision` | score the pipeline against `evals/` — costs credits |
| `user:add` | create a user |

## Layout

```
app/            routes and the RTL shell. No prompts, SQL, or model calls here
components/     ai-elements and shadcn primitives (vendored, ours to edit), plus chat/ and auth/
lib/ai/         provider, model roles, prompts, metering — the only place an endpoint is named
lib/answer/     the answer pipeline. HTTP-free, callable from a script
lib/knowledge/  normalize (shared by ingest and query), markdown splitting, method cards, ink
lib/db/         Prisma singleton, corpus versioning, usage, and vector.ts — the only raw SQL
lib/auth/       scrypt passwords and HMAC-signed session cookies
evals/          the scored question sets, text and vision
prisma/         schema, migrations, and the raw vector-index SQL
scripts/        every CLI in the table above
```

## Tests

`bun run test`. Each file pins a defect that reached a running product:

| File | What breaks if it goes |
| --- | --- |
| `lib/answer/mode-honesty.test.ts` | an answer wearing the teacher's badge without his method behind it |
| `lib/answer/method-card-gate.test.ts` | an unapproved, machine-drafted card quoted as the teacher's |
| `lib/answer/vision-contract.test.ts` | the photograph dropped before the final call, leaving only a transcript |
| `lib/answer/retrieve.test.ts` | the widening rule: too few exemplars must retry without the topic filter, never without the subject one |
| `lib/knowledge/options.test.ts` | a multiple-choice question asked without its options — it scans call sites, not just the helper |
| `lib/knowledge/normalize.test.ts` | ingest and query normalising differently, which destroys recall with no error |
| `lib/knowledge/chunk.test.ts` | the ingest splitter putting worked problems into the prose chunks |
| `lib/knowledge/ink.test.ts` | the teacher's coloured handwriting no longer separable from the printed slide |
| `lib/knowledge/persian-markdown.test.ts` | undelimited LaTeX left as raw text in the review sheet he approves from |
| `lib/ai/metering.test.ts` | a call that spends tokens without recording them, or runs past the daily cap |
| `lib/auth/session.test.ts` | a session cookie whose user id or expiry can be edited and still verify |
| `lib/db/conversations.test.ts` | one student reading or writing another's conversation |

The eval harness is separate and **not** part of `bun run test`: it calls real models and costs
credits. Any change to prompts, retrieval or models needs an eval delta before it ships.

## Notes from building it in Persian

Things that cost a session each and are written down so they do not cost another:

- **KaTeX has metrics for no Persian glyph.** Arabic is absent from its script table, so a
  Persian digit in a fraction is laid out as a zero-sized box and painted by whatever serif the
  device happens to have. The fix is one line — put a self-hosted Persian font in KaTeX's own
  fallback chain — not the line-height tuning three attempts went into.
- **A media timeline is not text.** Material Design says media controls stay LTR in every
  locale, because the scrubber is the tape. Left to inherit `dir="rtl"` it fills backwards and
  swaps elapsed with total.
- **Units are not fractions.** `\frac{kg}{m^3}` puts a superscript against a fraction rule and
  the digit gets clipped. `siunitx` defaults to inline for the same reason it renders better.
- **LaTeX in a prompt decays silently.** In a template literal `\frac` is the escape `\f`.
  Writing `\\frac` survives that; `String.raw` does not, because Bun escapes non-ASCII into the
  raw array and every Persian character arrives as `\u06XX`. `bun run check:prompts` guards it.
- **Digits reaching a speech model are a coin flip.** «۱۳/۶ گرم بر سانتی‌متر مکعب» came back as
  «شانزده»; spelled out it is verbatim. And «جرم» is read «جُرم» — *crime* — unless it carries
  its kasra.

## Conventions

The engineering constitution lives in [`.claude/skills/ostad/`](.claude/skills/ostad/), with
detail in its `references/`. The rules most often broken, in short:

- Bun only. Never npm/pnpm/yarn.
- Every model call goes through `lib/ai/provider.ts`, so it is metered and capped.
- Persian goes directly in JSX. There is no i18n layer and there will not be one.
- Tailwind logical properties only (`ms-`/`me-`/`ps-`/`pe-`), never `ml-`/`mr-`.
- Chat routes run on the Node runtime, never Edge.
- Read the docs for the installed version before calling an API. The versions here move faster
  than any model's training data.
