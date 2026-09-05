# Knowledge and retrieval contract

## Three layers, not one

The common failure in this kind of project is chunking the teacher's notes into
a vector store and expecting the model to answer "in the teacher's style". It
does not work — style does not survive chunking. We keep three distinct layers:

**1. Method cards.** One document per topic, one to three pages, describing the
teacher's approach explicitly: the order of steps, the notation, the shortcuts,
the traps they warn about. Drafted by the `fast` model from the notes, then
**approved by the teacher** before it is usable (`teacherApproved` flag).
Injected into the prompt directly — not retrieved by similarity.

**2. Solved exemplars.** Every worked problem as a structured record. Retrieved
by similarity and passed as few-shot examples. This is the only mechanism that
actually transfers style — the model sees real solutions to similar problems
before it writes its own.

**3. Raw chunks.** Notes and textbook text, for definitions and formulas. The
fallback layer, not the star.

## Schema

```prisma
model Subject  { id String @id @default(cuid())  title String }
model Teacher  { id String @id @default(cuid())  name String  voiceId String?  personaPrompt String }
model Chapter  { id String @id @default(cuid())  subjectId String  teacherId String  title String  ord Int }
model Topic    { id String @id @default(cuid())  chapterId String  title String }

model Chunk {
  id            String  @id @default(cuid())
  topicId       String
  subjectId     String                              // denormalized for pre-filtering
  corpusVersion Int
  source        String                              // "note" | "book"
  content       String
  contentNorm   String                              // normalizePersian(content)
  embedding     Unsupported("vector(768)")?
  @@index([subjectId, corpusVersion])
}

model Exemplar {
  id            String   @id @default(cuid())
  topicId       String
  subjectId     String
  corpusVersion Int
  question      String
  options       Json?
  answer        String
  solutionMd    String                              // the teacher's worked solution
  methodTags    String[]
  difficulty    Int?
  embedding     Unsupported("vector(768)")?
  @@index([subjectId, corpusVersion])
}

model MethodCard {
  id              String  @id @default(cuid())
  topicId         String
  corpusVersion   Int
  contentMd       String
  teacherApproved Boolean @default(false)
}
```

Phase 2 added four things this sketch does not show, all of them load-bearing:

- **`Exemplar.questionNorm`** — the normalized question, so the lexical half of the
  hybrid search has a column to index. Without it `to_tsvector` runs over raw text and
  the two halves of the search disagree about what a word is.
- **`IngestFlag`** — a record that fails Zod cannot become an `Exemplar`, so it lands
  here with its raw text and the reason. Dropping it silently leaves a hole in the
  corpus that nobody finds until a student asks about it.
- **`Setting`** — key/value; holds `activeCorpusVersion`. Flipping it is what makes an
  ingest live, and rolling back is the same UPDATE.
- **`@@unique`** on the taxonomy (`Subject.title`, `Chapter(subjectId,title)`,
  `Topic(chapterId,title)`) — re-ingest upserts the taxonomy and writes new knowledge
  rows against it, so the taxonomy is not versioned and must be addressable by name.

`subjectId` is denormalized onto `Chunk` and `Exemplar` even though it is
derivable through `Topic → Chapter`. That is deliberate: it lets Postgres
pre-filter on a btree index before the vector scan, which is the difference
between a fast correct search and a slow wrong one.

Because `embedding` is `Unsupported`, Prisma Client omits it from every result —
a useful side effect, since 768 floats should never reach the browser.

## Corpus versioning

Every knowledge row carries `corpusVersion`. Retrieval filters on the currently
active version, stored in a small settings row.

Re-ingesting writes a **new** version alongside the old one; when it is verified,
flip the active pointer. A mid-term notes update is then not an outage, rollback
is one UPDATE, and no in-flight conversation breaks. Never `TRUNCATE` and
re-ingest.

## Ingestion

`scripts/ingest.ts`, a CLI. Never a route handler — it will time out and you
will lose half a corpus.

Order of operations:

1. **Validate the markdown first.** Render every `$...$` block with KaTeX and
   report the ones that fail to compile. OCR and cleanup models corrupt math
   silently, and a formula that is valid-but-wrong produces no error anywhere
   downstream. This check is cheap and catches real damage.
2. Split on problem boundaries (heading levels, "تست"/"مثال" markers).
3. Extract each piece to structured JSON with the `fast` model, validate with
   Zod, and flag anything that fails schema for human review rather than
   dropping it.
4. Normalize (`normalizePersian`) into `contentNorm`.
5. Embed, then insert with raw SQL including the vector in the same statement —
   do not create through Prisma and then update the embedding.

Never claim an ingest succeeded without reporting counts: rows written, rows
flagged, formulas that failed to compile.

## Retrieval

```
subject filter (from UI selection)
  → topic filter (from classify)
    → hybrid: to_tsvector('simple', contentNorm) rank + pgvector cosine
      → top ~15
```

**No reranker in v1.** Once filtered by topic the candidate pool is a few dozen
rows; a reranker adds latency and a dependency for a gain the eval cannot see
yet. Add it if and when the eval says so.

Postgres has no Persian text-search configuration. Use the `simple` config over
our own normalized column — the normalization is doing the work that a language
dictionary would.

### The two-step read

Raw SQL returns ids and scores only; Prisma hydrates the rows:

```ts
// lib/db/vector.ts — the ONLY file with hand-written SQL
const hits = await searchExemplars(prisma, { queryText, queryEmbedding, subjectId, corpusVersion });
// caller hydrates:
const rows = await prisma.exemplar.findMany({ where: { id: { in: hits.map(h => h.id) } } });
```

`$queryRaw` results are untyped — validate with Zod at that boundary. This
confines SQL to one small function and keeps everything else typed.

Use the `pgvector` npm package's helper to pass vectors into raw queries rather
than string-building them.

## Embeddings

Query-time embedding runs on every message; ingest-time is one-off. Both go
through `lib/ai/provider.ts`.

**Prefixes are model-specific and getting them wrong is silent.** Confirm the
requirement for whichever model is configured, and keep both sides in one function
(`lib/ai/embed.ts`) exactly as the normalizer is kept in one function.

E5-family models want `query: ` / `passage: `. The model configured here,
`gemini-embedding-2`, does **not**: it deprecated the `task_type` request field — the
backend accepts and ignores it — and moved task conditioning into the text, so queries
carry `task: search result | query: …` and passages carry `title: none | text: …`.
Verified empirically (the prefix measurably changes the returned vector); the primary
written source is run-llama/llama_index#21535, not Google's own reference, so re-check
this when the model changes.

The vector dimension is hardcoded in the schema. Changing the embedding model
means a full reindex, so confirm the dimension before the first migration.

## Evals

`evals/<subject>.json` holds 50–100 questions with known answers.
`scripts/eval.ts` calls `answer()` directly — no HTTP.

Score three things: correct option, mode (`teacher` vs `standard`), and whether
retrieval surfaced the right topic. The last one localizes failures — when the
answer is wrong you need to know whether retrieval or generation broke.

**Any change to prompts, retrieval, or models reports an eval delta.** Without a
number, a refactor is a guess, and the ability to safely change things later is
the whole point of building this now rather than in month three.
