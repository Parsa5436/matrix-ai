# Audit ‚Äî 2026-08-28 (phase 1, pre-first-commit)

Auditor: opencode `audit` agent. Method: every finding verified against the
**installed** package in `node_modules` (docs, `.d.ts`), then the installed
skill, then (never needed here) the web. No finding below came from memory or
from a web search.

Baseline before any change: `typecheck` ‚úì ¬∑ `lint` ‚úì ¬∑ `check:seam` ‚úì ¬∑
`build` ‚úì (phase 1 gate passing; nothing in this audit broke it ‚Äî all four
re-run green after the fixes).

## Findings (in priority order)

### F1 ‚Äî P2 ‚Äî deprecated `textEmbeddingModel` (FIXED)

- **File:** `lib/ai/provider.ts:17`
- **What was wrong:** `avalai.textEmbeddingModel(MODELS.embedding)` calls a
  method the installed provider marks deprecated.
- **Source:** installed `@ai-sdk/openai-compatible@3.0.39`,
  `dist/index.d.ts` ‚Äî `OpenAICompatibleProvider.textEmbeddingModel` carries
  `@deprecated Use embeddingModel instead`. The docs page
  (`docs/index.mdx`) does not even mention `textEmbeddingModel`.
- **Change:** `avalai.textEmbeddingModel(...)` ‚Üí `avalai.embeddingModel(...)`.
  Same signature (`(modelId) => EmbeddingModelV4`), so zero behavioural risk.

### F2 ‚Äî P4 ‚Äî Radix-shaped `onSelect` handlers on Base UI menu items (FIXED)

- **File:** `components/ai-elements/prompt-input.tsx:411-413, 425-444, 446-490`
  (`DropdownMenuItemSelectEvent`, `PromptInputActionAddAttachments`,
  `PromptInputActionAddScreenshot`)
- **What was wrong:** the hand-patch derived
  `DropdownMenuItemSelectEvent` from `DropdownMenuItem["onSelect"]`. Base UI
  (which every `components/ui/*` primitive here wraps ‚Äî there is no Radix in
  the tree) has no `onSelect` on `Menu.Item`; its documented click handler is
  `onClick`. Grep over the installed `node_modules/@base-ui/react/menu/**`
  finds **zero** invocations of `onSelect`. The type only compiled because
  `onSelect` leaks in from native div DOM attributes (the text-selection
  event) ‚Äî so both menu actions were silent no-ops: the handler could never
  fire on a click. This is precisely the "Radix-shaped assumption" the patch
  was supposed to have removed.
- **Source:** installed `@base-ui/react@1.7.0`,
  `menu/item/MenuItem.d.ts` ‚Äî `onClick?: "The click handler for the menu
  item."`; no `onSelect` prop; grep of the whole `menu/` folder.
- **Change:** event type renamed to `DropdownMenuItemClickEvent`, now derived
  from `["onClick"]`; both components forward `onClick={handleClick}`;
  `AddScreenshot` forwards its consumer callback through `onClick` with the
  same `defaultPrevented` guard as before. Neither component is currently
  mounted (`page.tsx` renders `PromptInputTools` empty), so no
  already-verified behaviour changes.
- **Risk:** low ‚Äî unused code paths, typecheck/lint/build/seam all green
  after.

## Unverified (flagged, not judged ‚Äî no installed source answered)

- **`process.loadEnvFile()` under the Bun runtime** (`prisma.config.ts:5`).
  Node ‚â• 20.12 documents it; the Prisma CLI is what loads this file and it
  runs under Bun here. Bun's compat for this exact API is not verifiable from
  anything in this repo, and `bun.lock`/Bundocs are not ground truth I can
  read offline. It is wrapped in `try/catch`, and `.env` loading is confirmed
  working in practice (`next build` logs "Environments: .env"; migration ran
  in phase 1), so left alone. Worth one deliberate check the next time
  `db:migrate` runs on a machine without `.env`.
- **`rtl:-translate-x-[-50%]` in `components/ai-elements/conversation.tsx:88`**
  (scroll-button centering). Whether the negative-prefix arbitrary value
  resolves as intended in Tailwind 4, and whether the `rtl:` variant then
  double-flips, could not be confirmed from the installed tailwindcss docs
  shipped in `node_modules` (only the CSS engine is there, not docs). The
  phase 1 gate passed visually, so left as-is.

## Recommendations (not applied)

1. **`app/api/chat/route.ts:13-18` ‚Äî `BodySchema` validates `role` but not
   `parts`.** A malformed message body that passes the schema (no `parts`)
   throws inside `convertToModelMessages`, which happens *before*
   `createUIMessageStreamResponse`, so the client gets a bare 500 instead of
   the Persian error string. Strengthening the schema (or moving conversion
   inside a guarded stream) changes the verified phase 1 error path ‚Äî recommend,
   don't touch now. Also removes the `as unknown as UIMessage[]` double cast
   at `route.ts:30`.
2. **`components/ai-elements/conversation.tsx:45-46` ‚Äî `ConversationEmptyState`
   English default title/description.** Currently always overridden by
   `page.tsx` with Persian, so invisible; but the skill says every
   user-visible string is Persian. Translate the defaults when the component
   is next touched.
3. **Unused forward exports:** `ModelRole` (`lib/ai/models.ts:9`) and
   `embeddingModel` (`lib/ai/provider.ts:17`) have no importers yet. They are
   deliberate phase-2 surface ‚Äî keep, but they should gain callers or shrink
   in phase 2, not survive to phase 4.
4. **Docs drift:** `CLAUDE.md` (Commands) and the skill's
   `references/project-facts.md` (Scripts) list `bun run ingest` and
   `bun run eval`, which don't exist until phase 3. Both files self-declare as
   volatile/fixable ‚Äî sync them when `scripts/ingest.ts` and `scripts/eval.ts`
   land.

## Checked and clean (so the next audit skips these)

- **P1 config:** `lib/env.ts` ‚Äî `z.url()`, `.loose()` (route), `z.prettifyError`
  all confirmed against installed `zod@4.4.3` (`v4/classic/schemas.d.ts:197`,
  `v4/core/errors.d.ts:220`; `passthrough` is the deprecated one, `.loose()`
  is current). `prisma.config.ts` ‚Äî `defineConfig`, `env()`,
  `datasource.{url,shadowDatabaseUrl}`, `migrations.path`, `schema` all match
  installed `@prisma/config@7.10.0` (`dist/index.d.ts`); `datasource` has no
  `url` in `schema.prisma` (Prisma 7 keeps it in config ‚Äî correct);
  `lib/db/generated` gitignored as designed. `EMBEDDING_DIM`/shadow-DB
  derivation consistent with `db-bootstrap.ts` and `.env.example`.
- **P2:** `createOpenAICompatible({name, baseURL, apiKey})`,
  `.chatModel()`, model ids only from env (`MODELS`), roles not ids ‚Äî all
  match the installed docs/`.d.ts`.
- **P3:** `streamText({instructions})`, standalone
  `toUIMessageStream({stream, onError})` (result-method form is the *v7
  deprecated* path ‚Äî we're on the right one),
  `createUIMessageStreamResponse`, `await convertToModelMessages` (Promise),
  `MockLanguageModelV4` from `ai/test`, `simulateReadableStream` ‚Äî all
  confirmed against `node_modules/ai@7.0.83` docs + `.d.ts`.
  `runtime = "nodejs"`, `maxDuration = 60` valid Next 16 segment config
  (`node_modules/next/dist/docs/.../route-segment-config/`). **Deps seam
  holds:** `lib/answer/*` imports only `ai`, `lib/ai/prompts`, and its own
  `types`; `check:seam` proves the pipeline runs against a fake with no
  provider and no HTTP.
- **P4:** message.tsx patch verified against installed
  `@streamdown/math@1.0.2` (`MathPluginOptions.singleDollarTextMath`, default
  false) and `streamdown@2.6.0` (`PluginConfig{cjk,code,math,mermaid}`,
  `isAnimating` is a real prop). All `components/ui/*` import from
  `@base-ui/react` ‚Äî no Radix anywhere. `InputGroupButtonClickEvent` derives
  from a real prop.
- **P5:** tree-wide grep (`app/ components/ lib/ scripts/ hooks/`) for
  `ml- mr- pl- pr- left- right- text-left text-right` (incl. negative
  variants): **zero hits**. No `t(`, no i18n/locale/useTranslation remnants,
  no locale directories. `components.json` has `"rtl": true`. Persian strings
  inline in JSX; logs in English.
- **P6:** Tailwind 4 config lives in `app/globals.css` (`@import
  "tailwindcss"`, `@theme inline`, `@source` for streamdown) ‚Äî no
  `tailwind.config.js`, correct for v4. Biome 2.5.10 schema matches installed
  version; tab/double-quote per project-facts. `package.json` scripts match
  the phase (minus the phase-3 ones listed above). Fonts self-hosted via
  `next/font/local` in `app/layout.tsx`; KaTeX CSS loaded once in the root
  layout; `<html lang="fa" dir="rtl">`.
- **Dead-code sweep:** no i18n layer remnants, no `enable_vector` migration
  remnants (repo has no commits yet; migrations dir holds only the lock, and
  `schema.prisma` deliberately has no models in phase 1). `probe.ts`'s raw
  `fetch` and `db-bootstrap.ts`'s direct `process.env` reads are documented,
  justified deviations, not drift.

## Verification results (after fixes)

```
bun run typecheck   ‚Üí tsc --noEmit                exit 0
bun run lint        ‚Üí biome check (38 files)      exit 0
bun run check:seam  ‚Üí "answer seam ok ‚Ä¶"          exit 0
bun run build       ‚Üí next build ‚úì (5/5 pages)    exit 0
```

---

# Audit ‚Äî 2026-08-28 (phase 2, second run)

Auditor: opencode `audit` agent. Same method: verify against the installed
package, then the installed skill, then (not needed this run) the web. Every
regex, string comparison, and filter predicate touching Persian was proven by
running it, not by reading it.

Baseline: `bun test` 15/15 (14 pre-existing + this run's new test) ¬∑
`typecheck` ‚úì ¬∑ `lint` ‚úì ¬∑ `check:seam` ‚úì ¬∑ `build` ‚úì ‚Äî before any change, and
re-run green after. Phase 1 and phase 2 gates intact.

## Findings (in priority order)

### F1 ‚Äî P4 ‚Äî DISPLAY_MATH crossed blank lines, contradicting its own comment (FIXED)

- **File:** `lib/knowledge/chunk.ts:18-23` (`DISPLAY_MATH`), consumed by
  `extractFormulas` ‚Üí the KaTeX validator in `scripts/ingest.ts`.
- **What was wrong:** the comment promised "Neither pattern crosses a blank
  line", but the pattern was `/\$\$([^$]+?)\$\$/g` ‚Äî `[^$]` matches newlines.
  **Proven by running it** (bun):
  `extractFormulas("$$\nx^2\n\n\text{swallowed}\n$$")` returned
  `"x^2\n\ntext{swallowed}"` as one "formula". Consequence: prose swallowed
  across a paragraph break is handed to KaTeX ‚Äî either flagged as a broken
  formula (validator noise) or, when the swallowed text happens to compile,
  validated as a formula and never reported (the silent direction). This is
  the run's target class: the code did something other than what its own
  documentation claimed, with no error.
- **Source:** runtime proof against the installed parser; the file's own
  comment is the contradicted contract. (Not web, not memory.)
- **Change:** `/\$\$((?:[^\n]|\n(?!\n))+?)\$\$/g` ‚Äî the interior may contain
  single line breaks, ends at a blank line, and the outer group stays
  **capturing**. New test in `chunk.test.ts` pins both the rejection and the
  single-line-break case.
- **Regression caught during the fix, fixed before it landed:** the first
  version of the pattern used a *non-capturing* group `(?:...)`. `matchAll`
  still matched, lint passed ‚Äî but `extractFormulas` reads the interior by
  index (`m[1]`), which became `undefined`, so the extractor returned `[]`
  for every input, including valid ones. The test suite caught it (2 fail);
  root-caused with an instrumented loop (`groups: []`), fixed by keeping the
  capture, and re-verified: 15/15, and the fixture corpus still yields the
  same 87 formulas with the same single intentional KaTeX failure. A regex
  read by group index treats its group structure as API; the positive tests
  are what make that visible.

### F2 ‚Äî P3 ‚Äî index verification (no defect: verified, with one nuance recorded)

Not a finding ‚Äî recorded because the priority asked for proof, not
assertions. Live DB (`DATABASE_URL`, read-only probes):

- pgvector **0.8.1**; migration `20260828134723_knowledge_base` applied.
- All four custom indexes exist with correct definitions:
  `chunk_embedding_hnsw` / `exemplar_embedding_hnsw` both
  `USING hnsw (embedding vector_cosine_ops)` (matching the `<=>` operator the
  query uses), and both GIN indexes on the exact FTS expression used
  (`to_tsvector('simple', "contentNorm")` / `"questionNorm"`).
- **HNSW proven usable on the real query shape:** with `enable_sort=off`,
  EXPLAIN flips the semantic half to `Index Scan using exemplar_embedding_hnsw
  ... Order By: (embedding <=> ‚Ä¶)` with subject+version+topic filters applied.
  At the current fixture size (8‚Äì12 rows/table) the planner *prefers* the
  btree + sort ‚Äî a correct cost decision, not an index defect; re-check with
  EXPLAIN after real-scale ingest.
- **GIN proven usable:** with the `@@` predicate alone and `enable_seqscan=off`,
  EXPLAIN shows `Bitmap Index Scan on chunk_contentnorm_fts` with the
  expression as Index Cond ‚Äî the expression index matches. In the filtered
  hybrid query the btree wins on cost at this size, for the same reason.
- **Persian through the FTS pipeline proven:** `plainto_tsquery('simple',
  'ŸÖÿ¥ÿ™ŸÇ ÿ™ÿßÿ®ÿπ ŸÜŸÖÿß€å€å')` produces `'''ŸÖÿ¥ÿ™ŸÇ'' & ''ÿ™ÿßÿ®ÿπ'' & '''ŸÜŸÖÿß€å€å'''` ‚Äî three
  Persian lexemes, correctly tokenized from the normalized column.
- Full hybrid RRF query ran end-to-end and returned rows; the EXPLAIN of it
  also confirms vector.ts's SQL is valid Postgres as emitted.

### P1 ‚Äî lib/db/vector.ts ‚Äî verified clean

- **RRF fusion correct:** `COALESCE(1.0/(k+lexical.rank),0) +
  COALESCE(1.0/(k+semantic.rank),0)` over a FULL OUTER JOIN ‚Äî a hit in only
  one list contributes its single term (NULL rank ‚Üí NULL ‚Üí 0 via COALESCE);
  a hit in both adds both. Standard reciprocal rank fusion.
- **Filters in every path:** both the lexical and the semantic CTE carry
  `subjectId` and `corpusVersion` unconditionally; `topicFilter` is additive
  (`Prisma.empty` when absent). No branch skips them.
- **No string building:** vectors go through `pgvector.toSql(...)` as bound
  parameters with a `::vector` cast; identifiers come only from the fixed
  literal unions at the two call sites; everything else is parameterized.
- **Zod boundary cannot pass a malformed row:** `Number(r.score)` normalizes
  driver string/Decimal forms, and ‚Äî verified against installed zod@4.4.3 ‚Äî
  `z.number()` rejects NaN **and** Infinity, so `Number("garbage")` cannot
  slip through; `id` requires a non-empty string; failure throws loudly.
- Two-step read respected: ids and scores out, hydration via Prisma belongs
  to the caller (phase 3).

### P2 ‚Äî scripts/ingest.ts + lib/ai/json.ts ‚Äî verified clean, two observations

- INSERT carries row **and** vector in one `$executeRaw` with bound
  parameters, per the rag contract; taxonomy upsert keys match the schema's
  unique constraints; `--activate` flips the pointer only at the end, so a
  failed run can never promote a half corpus.
- `generateJson` implements the documented idiom exactly (prompt for JSON ‚Üí
  strip fences ‚Üí safeParse ‚Üí retry once with the validation error appended ‚Üí
  typed `JsonExtractionError`), and takes `deps` ‚Äî the seam holds.
- No silent-drop path: schema failures land in `IngestFlag` + the report,
  formula failures are flagged and counted, embedding/insert failures throw
  loudly before any pointer flip, and the report prints rows written /
  flagged / formulas failed.
- **Observation (recommendation below):** flags are persisted at step 7,
  *after* method-card drafting (step 6). A `generateText` throw in the card
  loop aborts before `IngestFlag` rows are written and before the report
  prints. The written knowledge rows survive in the inactive version and a
  re-run recomputes the same flags deterministically, so nothing is silently
  lost ‚Äî but the flag report depends on a later step not failing.

### P4 ‚Äî normalize.ts / chunk.ts vs installed Unicode behaviour ‚Äî clean (after F1)

- normalizePersian covers every item in the skill's checklist: Ÿä/Ÿâ‚Üí€å, ŸÉ‚Üí⁄©,
  ÿ©/€Å/ÿ£/ÿ•/Ÿ± folds, Persian (U+06F0-9) + Arabic-Indic (U+0660-9) digits ‚Üí
  ASCII, diacritics U+064B-065F + U+0670 + U+06D6-06ED stripped, tatweel
  stripped, zero-width (U+200B-200D, U+FEFF) removed, NFC first, whitespace
  collapsed. Idempotency and corpus/student convergence are pinned by tests
  using real Persian.
- PROBLEM_HEADING `/^(ŸÖÿ´ÿßŸÑ|ÿ™ÿ≥ÿ™|ŸÜŸÖŸàŸÜŸá|ÿ™ŸÖÿ±€åŸÜ)/` ‚Äî no `\b`, proven against the
  real fixture: 12 exemplars parsed across the two corpus files, matching the
  row counts in the live database.
- INLINE_MATH `(?<!\$)\$([^$\n]+?)\$(?!\$)` ‚Äî line-bounded, fence-safe;
  verified.
- All other regexes in `lib/` and `scripts/` enumerated by grep; every one
  either operates on ASCII/Latin input by design (fence stripping, SSE
  parsing, probe colour words) or is covered above.

### P5 ‚Äî app/api/chat/route.ts ‚Äî the fix is genuine

- The `as unknown as UIMessage[]` cast is **gone**. `BodySchema` now
  validates `id`, `role`, and `parts` (text-only, matching the composer), and
  the Zod-inferred type is *structurally assignable* to `UIMessage[]` ‚Äî
  typecheck enforces it, so the soundness is not an act of faith. The 400
  path answers in Persian while logging the schema detail in English, exactly
  per the skill. Run-1 recommendation implemented properly.

## Unverified

- Nothing was sourced from the web this run.
- Index choice at **real corpus scale** cannot be observed with 12-row
  fixtures; usability was proven with forced planner settings (above). Re-run
  plain EXPLAIN on the hybrid query after the first real ingest.
- Run 1's open item stands: `process.loadEnvFile()` under the Bun runtime is
  confirmed only empirically (it works), not against any installed doc.

## Recommendations (not applied)

1. **ingest.ts:** persist `IngestFlag` rows (and print the report) *before*
   drafting method cards, or wrap the card loop per-topic and flag failures ‚Äî
   so a card-drafting failure cannot defer/lose the human-review queue.
   Not applied: it reorders verified gate behaviour for a robustness gain;
   the current failure mode is loud, not silent.
2. **corpus.ts:** `getActiveCorpusVersion` does `Number(row.value)` ‚Äî a
   hand-edited Setting value could yield NaN and silently empty every
   retrieval. Only our scripts write the row; harden with an integer check if
   DB hand-edits ever become a thing.
3. **chunk.ts:** prose between an h1 and the first h2 is dropped (no topic to
   attach to; the schema requires topicId). Documented input contract, but
   the ingest report does not count the dropped lines ‚Äî consider a counter if
   real chapters ever carry chapter-level intro prose.

## Checked and clean (this run, so the next audit skips)

- `lib/db/client.ts` ‚Äî Prisma 7 driver-adapter singleton via
  `@prisma/adapter-pg`, env only through `lib/env.ts`, dev-global guard.
- `lib/db/corpus.ts` ‚Äî version allocation is max+1 across both tables, never
  reuses a live version; activation refuses an empty corpus
  (`scripts/corpus-activate.ts` also refuses and prints the transition).
- `lib/ai/embed.ts` ‚Äî prefixes live in one place (`asQuery`/`asPassage`),
  dimensions requested explicitly from env via providerOptions keyed by the
  provider name; matches the schema's vector(768).
- `lib/ai/schemas.ts` ‚Äî extraction and vector-hit contracts in one home;
  `difficulty` bounded 1‚Äì5, `methodTags` ‚â§ 6.
- `lib/knowledge/method-cards.ts` ‚Äî `teacherApproved: true` enforced at the
  only read path.
- `prisma/schema.prisma` ‚Üî migration ‚Üî live DB agree (columns, btree
  indexes, unique keys used by the upserts, FKs with cascade);
  `vector(768)` matches `EMBEDDING_DIM`.
- `prisma/sql/vector-indexes.sql` ‚Äî idempotent, superuser-guard extension
  check, cosine opclass on both tables, GIN on the exact searched
  expressions, runnable by the app role.
- Fixture corpus (`content/`) ‚Äî real UTF-8 Persian, shape matches the parser
  contract, includes one intentionally broken formula that exercises the
  flag path.
- Tests: 15/15 (`bun test`), Persian-input tests throughout the knowledge
  layer.

## Verification results (after fixes)

```
bun test             ‚Üí 15 pass, 0 fail              exit 0
bun run typecheck    ‚Üí tsc --noEmit                 exit 0
bun run lint         ‚Üí biome check (52 files)       exit 0
bun run check:seam   ‚Üí "answer seam ok ‚Ä¶"           exit 0
bun run build        ‚Üí next build ‚úì (5/5 pages)     exit 0
fixture re-check     ‚Üí 87 formulas, 1 intentional KaTeX failure (unchanged)
live-DB probes       ‚Üí read-only (pg_indexes, EXPLAIN, counts, one smoke SELECT)
```

---

# Audit ó 2026-08-30 (third run, full-project refactor scope)

Auditor: opencode `audit` agent. Method as runs 1-2: every finding verified against
the **installed** package (`node_modules` docs/`.d.ts`), then the installed skill,
then the web (not needed this run). Caller claims proven with `graft callers` /
`graft grep` plus a ts+tsx grep. The Tailwind question was settled by compiling
with the installed `@tailwindcss/postcss`, not by reasoning about it.

Baseline before changes: `typecheck` ? ∑ `lint` ? ∑ `bun test` 68/68 ? ∑
`check:seam` ? ∑ `build` ? ∑ `bun run eval` **33/33** ?. All re-run green after
each batch; final state: 69/69 tests (one new), eval still **33/33**.

## Findings (in priority order)

### F1 ó P2 ó junk maths in the ????? method card (FIXED in the file; DB copy pending)

- **File:** `content/derived/method-cards.md:956`
- **What was wrong:** the card carried `(????? ????? $\frac{200}{V' + \Delta}$ ??
  $200 = \Lambda V' + \Delta'$)` ó a Persian digit misread as a Greek letter. The
  project's own flags file (`method-cards-flags.md:100-101`) already rules it
  out: *"The teacher never uses the Greek letter Lambda; the symbol in the slide
  is the Persian digit 8."* The grounding-removal step in `scripts/method-cards.ts`
  missed this variant of the claim, so it survived into the card that
  `cards --apply` loads **verbatim into every ????? answer prompt**.
- **Source:** the flags file's verdict + read-only DB probe: the approved card in
  the live database (corpusVersion 3, topic ´??????? ??? ?? ????? ???? ??????ª)
  contains the same `\Lambda`/`\Delta` string.
- **Change:** removed the parenthetical example; the sentence's real method signal
  (total mass in the numerator, isolate $V'$) is kept. No corrected formula was
  invented ó the card's own editorial rule is to keep only what the teacher wrote.
- **Risk:** none at runtime ó the file is the review artifact; nothing reads it
  until `cards --apply`. The DB copy still carries the junk; see
  Recommendations #1. The eval's 33/33 was measured against the current DB
  prompt content, so applying without re-running the eval would be an unverified
  behaviour change.

### F2 ó P4 ó dead export `searchChunks` (FIXED ó deleted)

- **File:** `lib/db/vector.ts:100-101`
- **What was wrong:** exported with zero callers anywhere (graft: 0 in-edges;
  grep over `*.ts` + `*.tsx` + tests). Run 1's recommendation said unused exports
  "should gain callers or shrink in phase 2, not survive to phase 4" ó this one
  survived to phase 4+. The pipeline retrieves exemplars only; when note
  retrieval lands it is a two-line restoration.
- **Source:** `graft grep "searchChunks"` (0 in-edges) + repo-wide grep.
- **Change:** deleted. `searchExemplars` and the shared `search` core untouched.

### F3 ó P4 ó dead export `ModelRole` (FIXED ó unexported)

- **File:** `lib/ai/models.ts:9`
- **What was wrong:** exported type with zero importers (run 1 flagged it; it
  never gained a caller). Only `ChatRole = Exclude<ModelRole, "embedding">` uses
  it, in the same file.
- **Source:** `graft grep "ModelRole"` (0 in-edges on the export) + grep.
- **Change:** `export type` ? `type`. Behaviour identical; the public surface
  shrinks to what is used.

### F4 ó P4 ó dead export `tokensUsedInWindow` (FIXED ó unexported)

- **File:** `lib/ai/metering.ts:25`
- **What was wrong:** exported, but its only caller is `meteredModel` in the same
  file. No test imports it.
- **Source:** grep over ts/tsx/tests.
- **Change:** `export async function` ? `async function`.

### F5 ó P3 ó `PERSIAN_DIGITS` defined three times (FIXED ó one home)

- **Files:** `lib/knowledge/options.ts:9`, `scripts/eval.ts:60`,
  `scripts/review.ts:49`
- **What was wrong:** the same digit string defined in three files, with the
  ASCII?Persian conversion logic living only in eval.ts while review.ts
  hand-indexed the string. This is the exact two-consumer shape that produced
  the option-cleaner and asAsked defects: a fix to one copy silently misses the
  others.
- **Source:** grep `PERSIAN_DIGITS` over ts/tsx ó three definitions.
- **Change:** `toPersianDigits` exported from `lib/knowledge/options.ts` (the
  option-domain home, which already owned the constant); both scripts import it;
  review.ts converts via the function instead of indexing. New test in
  `options.test.ts` pins the conversion (69th test).
- **Risk:** low ó the eval's scoring path never calls `toPersianDigits` (only
  `--build` does), and the review script's output is byte-identical
  (`PERSIAN_DIGITS[i+1]` = `toPersianDigits(String(i+1))` for i in 0..3).

### F6 ó P5 ó false comment on DUMMY_HASH (FIXED ó comment only)

- **File:** `app/login/page.tsx:75-77`
- **What was wrong:** the comment claimed "A real scrypt hash of a value nobody
  has". Decoding the constant shows the salt is `abcdefghijklmnop` and the key is
  `bogus` repeated ó a well-formed *format*, not a genuine scrypt output. The
  load-bearing property (an unknown username costs the same full scrypt
  computation as a known one) holds regardless, because `verifyPassword` derives
  from the stored salt and length either way.
- **Source:** decoded the base64 fields with bun.
- **Change:** the comment now states the true mechanism. No code change.

## The two specific items

1. **????? card** ó see F1.
2. **Structural pass: lib/answer, lib/knowledge, lib/db vs
   `references/architecture.md`.** Verdict: **the runtime boundaries hold; the
   doc's file lists are stale but its rules are not violated.**
   - `app/` adapts HTTP only: no prompt string, no SQL, no model call in any
     route/page. ?
   - **Deps seam holds:** no file under `lib/answer/` imports
     `lib/ai/provider`; `check:seam` proves the pipeline runs against a fake
     with no provider and no HTTP. ?
   - `lib/db/vector.ts` is still the only raw-SQL file. ?
   - `components/` imports lib types only (`SubjectOption`, `AnswerMode`,
     `SourceRef`). ?
   - Scripts call `answer()` directly with no HTTP (eval, review). ?
   - **Doc drift (the doc is behind, not wrong):** the folder contract predates
     `lib/answer/{general,topics}.ts`, `lib/knowledge/{load,options,ink,
     persian-markdown,method-cards}.ts`, and `lib/db/{corpus,subjects,
     conversations}.ts`. Every one sits in the right layer for the rules the doc
     does state. `app/api/upload/route.ts` is listed but correctly absent
     (phase 5).
   - **Two type-only arrow inversions** (Recommendation #2): `lib/ai/json.ts:4`
     and `lib/knowledge/load.ts:6` import `Deps` from `@/lib/answer/types` ó
     on paper inverting the documented `answer ? ai/knowledge` arrow. Both are
     `import type`, erased at runtime; no cycle, seam intact.

## Version-sensitive APIs ó verified against node_modules this run

All confirmed against the installed versions; none required a web search:

- `@ai-sdk/react@4.0.86` ó `useChat` takes `ChatInit`: `messages?: UI_MESSAGE[]`
  (initial messages), `transport?`, `onData?` ó exactly what `chat.tsx` passes.
- `ai@7.0.83` ó `PrepareSendMessagesRequest` returns `{ body: object }`;
  `ChatStatus = 'submitted' | 'streaming' | 'ready' | 'error'` (matches
  `PromptInputSubmit`); `LanguageModelV4Usage` carries
  `inputTokens.total` / `outputTokens.total` (matches `metering.ts` at both the
  generate result and the stream `finish` part); `LanguageModel` includes a
  string variant, so `meteredModel`'s `typeof model === "string"` guard is
  load-bearing, not paranoia; the `ai`-level `FilePart` documents bare
  `DataContent` (Uint8Array) as a valid shorthand ó `json.ts` is correct, and
  `{ type: 'image' }` is confirmed `@deprecated` in `@ai-sdk/provider-utils`;
  `toUIMessageStream` standalone form, `streamText({ instructions })` (`system`
  is the deprecated spelling), `convertToModelMessages` ? Promise, and
  `DataUIPart`'s `` type: `data-${NAME}` `` (the route's data-conversation /
  data-mode / data-sources writes) all re-confirmed.
- `@ai-sdk/openai-compatible@3.0.39` ó the only `@deprecated` in its `.d.ts` is
  `textEmbeddingModel ? embeddingModel`, already fixed in run 1.
- `next@16.2.6` ó `params`/`searchParams` as `Promise`, async `cookies()`
  confirmed in `node_modules/next/dist/docs`.
- `tailwindcss@4.3.3` ó see the closed unverified item below.

## Unverified (carried or new)

- **`process.loadEnvFile()` under the Bun runtime** (`prisma.config.ts`) ó
  carried from runs 1-2. Still nothing installed to check it against; confirmed
  only empirically (it works).
- **Index choice at real corpus scale** ó carried; re-run plain EXPLAIN on the
  hybrid query after the first real-scale ingest.
- Nothing else. No finding this run came from the web.

## Closed this run (was open from run 1)

- **`rtl:-translate-x-[-50%]` in `conversation.tsx:88`** ó verified by
  compiling a sample with the installed `@tailwindcss/postcss`:
  `.start-[50%]` ? `inset-inline-start: 50%`; `.translate-x-[-50%]` ?
  `--tw-translate-x: -50%`; the `rtl:` variant compiles to
  `--tw-translate-x: calc(-50% * -1)` scoped to
  `:where(:dir(rtl), [dir="rtl"], [dir="rtl"] *)`. In an RTL document the
  element is anchored at the inline-start edge (right) and shifted +50% of its
  width ó centred, no double-flip. The class combination is correct; item closed.

## Recommendations (not applied)

1. **Re-apply the corrected ????? card to the database.** The file is fixed but
   the approved card in the live DB (corpusVersion 3) still carries the
   `\Lambda` junk and is quoted into every ????? answer. Fix:
   `bun run cards --apply`, then `bun run eval` and require 33/33 again. Not
   applied here because it changes prompt content the verified eval ran
   against ó that is a behaviour change needing an explicit go.
2. **Type-only `Deps` inversions** (`lib/ai/json.ts:4`, `lib/knowledge/load.ts:6`).
   Minimal fix: both take `{ llm: (role: ChatRole) => LanguageModel }`
   structurally instead of importing `Deps` from `lib/answer/types`. Zero
   runtime effect; pure documentation honesty. Left because it touches
   seam-adjacent files for no behavioural gain.
3. **`references/architecture.md` file lists are stale** ó add the new files
   (or state that the lists are illustrative) next time the skill is touched.
   The doc's rules are all still satisfied.
4. **The general branch drops history.** `pipeline.ts`'s general branch sends
   only `input.question`, so a follow-up ´????ª classified general inside a
   subject conversation loses context ó while the no-subject path
   (`streamGeneralAnswer`) converts the full message list. Related: the
   no-subject path persists nothing (no conversation row). Both are product
   decisions, not defects; record and decide before phase 5.
5. **`ConversationEmptyState` English defaults** ó carried from run 1; still
   always overridden with Persian by `page.tsx`, still invisible.

## Checked and clean (this run, so the next audit skips)

- `lib/answer/{pipeline,classify,retrieve,assemble,types,general,topics}.ts` ó
  stage order matches the contract; mode emitted first; subject filter never
  removed (widening drops only the topic filter, pinned by retrieve.test.ts);
  mode honesty ("teacher" requires card or exemplars) pinned by
  method-card-gate.test.ts; topics.ts is data with a named author and a
  replacement plan.
- `lib/ai/{provider,models,embed,json,schemas,prompts,metering}.ts` ó model ids
  only from env; embedding prefixes in one place; providerOptions keyed by the
  provider name; JSON idiom (prompt ? strip ? validate ? retry once) intact;
  quota enforced at the model wrapper, never-fail meter row; prompts live in
  the documented home.
- `lib/db/{client,corpus,subjects,conversations,vector}.ts` ó ownership filter
  in every read/write (pinned against live Postgres); version allocation
  max+1; activation refuses an empty corpus; RRF fusion and unconditional
  subject/version filters unchanged from run 2's verification.
- `lib/auth/{session,password}.ts` ó HMAC cookie with timing-safe compare and
  expiry; scrypt with parameters embedded in the hash; NFKC canonicalisation
  for keyboard variance; both pinned by tests.
- `lib/knowledge/{normalize,chunk,ink,options,persian-markdown,method-cards}.ts`
  ó unchanged from run 2's verification plus this run's options.ts export.
- `app/` ó login (dummy-hash timing defence), chat layout (auth by
  construction, sidebar, sign-out server action), c/[id] (ownership ? 404,
  parts narrowed on read), not-found (Persian, "not found" wording), route
  (schema covers what convertToModelMessages reads; quota at the provider;
  ownership before any write; mode/sources persisted as data parts).
- `components/ai-elements/*` ó run 1's Base UI patches intact
  (`DropdownMenuItemClickEvent` from `onClick`; both menu actions forward it);
  message.tsx `singleDollarTextMath: true` patch intact; memo comparator on
  MessageResponse matches streamdown@2.6.0's real `isAnimating` prop.
- `components/ui/*` ó all Base UI; the only `left`/`right` hits are
  `data-[side=left/right]` animation variants (Base UI's physical popup sides),
  not layout properties.
- `scripts/*` ó ingest/ingest-slides share `loadCorpus` (the load path has one
  home); eval/review both go through `asAsked`/`cleanOption(s)` (pinned by the
  call-site scan test); method-cards merge/grounding flow unchanged;
  build-deck/ink oracle unchanged; probe/db-bootstrap documented deviations
  unchanged.
- `prisma/schema.prisma` ó matches the architecture contract: `parts Json`,
  `audioUrl` from day one, `corpusVersion` on all knowledge rows, denormalised
  `subjectId`, `dailyTokenCap` on the row not in config.
- Configs ó `biome.json` (2.5.10 schema, tab/double-quote, ui overrides),
  `next.config.ts` (empty), `components.json` (`rtl: true`), `globals.css`
  (Tailwind 4 in CSS, `@source` for streamdown), `.env.example` matches
  `lib/env.ts` including `SESSION_SECRET`.
- Tests ó 10 files, 69 tests, Persian-input tests throughout; the asAsked
  call-site scan still reaches the call sites it guards.

## Verification results (after all fixes)

```
bun run typecheck   ? tsc --noEmit                exit 0
bun run lint        ? biome check (89 files)      exit 0
bun test            ? 69 pass, 0 fail (was 68)    exit 0
bun run check:seam  ? "answer seam ok Ö"          exit 0
bun run build       ? next build ? (5 routes)     exit 0
bun run eval        ? 33/33 correct option        exit 0
                      33/33 mode = teacher
                      33/33 right topic retrieved (unchanged)
live-DB probes      ? read-only (method-card content check)

---

# Fourth pass ó 2026-08-30 (refactor, not audit)

Mandate: code quality, not defect-hunting. Every source file read and judged
against the four questions (10-minute comprehension, simplest shape, phase 5/6
friction, library feature that deletes code). ostad read fully first; file-specific
skills read per area; one file changed per batch, full gates after each.

**Premise correction:** the brief said components/ai-elements holds "~40 vendored
files, never read line by line". The directory holds **3 files** (conversation.tsx
168 lines, message.tsx 365, prompt-input.tsx 1470) and run 3 did read all three.
The count was `ls`-checked before this pass began. app/ genuinely received zero
findings in run 3; this pass gives it its first one (below).

## Per-file table

### app/

| File | Purpose | Verified against | Changed | Left |
| --- | --- | --- | --- | --- |
| app/layout.tsx | root shell: self-hosted Vazirmatn, `dir="rtl"`, direction/theme/tooltip providers | next/dist/docs (next/font/local); ostad RTL rules | ó | `cn` on two static strings is the shadcn idiom |
| app/not-found.tsx | Persian 404, "not found" wording per getConversation comment | ostad rtl-persian (Persian strings) | ó | nothing to change |
| app/login/page.tsx | login + inline server action + dummy-hash timing defence | next/dist/docs (server actions, `searchParams: Promise`); node:crypto | ó | `scryptSync` blocks the loop ~50ms per attempt ó decision item D4 |
| app/(chat)/layout.tsx | auth-by-construction guard, sidebar, sign-out action | vercel best practices ß3.1/ß3.7 (auth in action, parallel fetch ó both already correct) | ó | ó |
| app/(chat)/page.tsx | new-conversation page | ó | ó | ó |
| app/(chat)/c/[id]/page.tsx | conversation page; ownership ? 404 | next/dist/docs page.md (`params: Promise`); conversations.test.ts | ó | the one cast is documented at both ends |
| app/api/chat/route.ts | HTTP adapter: schema, quota, general vs subject branch, UI-part streaming, persistence | ai@7 `.d.ts` (ChatStatus, DataUIPart, toUIMessageStream) | `Parameters<typeof languageModel>[0]` ? `ChatRole` (a type reflection spelled a name that exists one import away) | 208 lines are linear and sectioned; the writer adaptation is the route's job per architecture.md; general/subject asymmetry ? decision D3 |
| app/globals.css | Tailwind 4 theme (CSS-first config) | tailwindcss@4.3.3; run 3 compile probe | ó | vendored shadcn theme, internally consistent |

### components/ai-elements/ (3 files ó see premise correction)

| File | Purpose | Verified against | Changed | Left |
| --- | --- | --- | --- | --- |
| conversation.tsx | scroll container, empty state, scroll button, download | tailwindcss@4.3.3 (run 3 compile probe for rtl centering) | `ConversationEmptyState` defaults ? Persian (carried as a recommendation by runs 1 and 3; now settled) | ConversationDownload + messagesToMarkdown unused ? prune D1 |
| message.tsx | message frame, branch family, MessageResponse renderer | streamdown@2.6.0 (`singleDollarTextMath`, `isAnimating`); run-1 patches intact | ó | MessageBranch family + Actions/Toolbar (~270 of 365 lines) unused ? prune D1; `is-user:dark` is upstream's own shape, provably inert |
| prompt-input.tsx | composer + attachments machinery | @base-ui/react@1.7.0 (run-1 onClick patch intact); ai@7 (FileUIPart) | ó | attachments/file-input machinery is the phase-5 surface (keep); Provider/Select/HoverCard/Tabs/Command/ActionMenu families unused ? prune D1; oxlint-disable comments are inert under Biome and go with any prune |

### components/chat and components/ui

| File | Purpose | Verified against | Changed | Left |
| --- | --- | --- | --- | --- |
| components/chat/chat.tsx | chat UI, useChat wiring, subject select | **@ai-sdk/react@4.0.86 dist/index.js, read**: `latestRef.current.transport` is written every render and read at send time; the Chat instance is created once via `useRef` and is not recreated on transport identity change | ó | the inline `new DefaultChatTransport({...})` with fresh closures over `subject`/`conversation.current` is the SDK's intended pattern, not a re-render smell; a useMemo would add a staleness hazard for zero gain |
| components/chat/answer-card.tsx | mode badge, response, sources | ai@7 UIMessage data parts | ó | ó |
| components/ui/* (14 files) | Base UI primitives | @base-ui/react@1.7.0 (run 1); re-glanced this pass | ó | dialog/separator/textarea: zero importers; button-group/command/hover-card/select/dropdown-menu/input-group reachable only via unused ai-elements paths ? prune D1 |
| components/theme-provider.tsx | next-themes wrapper + ThemeHotkey | next-themes | ó | ThemeHotkey (bare "d" toggles dark mode) is scaffold demo code but the product's only theme control ? decision D2 |

### lib/ (30 files) ó smell sweep, all re-read

Changed: none. The run-3 pass already pruned this layer (dead exports, the
duplicated constant). This pass' checks: every `as unknown as` in the tree is
documented at its site (probe raw-SSE parse, three test doubles, Prisma
dev-global, JSONB input); export inventory clean; no function carries hidden
phase history. Notable lefts, each with its reason:

- retrieve.ts hydrates ids via `byId` map + `flatMap` ó the type-safe idiom
  under `noUncheckedIndexedAccess` (`map` + `filter(Boolean)` does not narrow
  without a predicate).
- json.ts prompts for JSON instead of native structured output ó mandated by
  the constitution (resellers may not proxy `response_format`).
- metering.ts wraps the model rather than using a route-level `onFinish` ó the
  documented enforcement point ("the only way to spend a token is through the
  object that counts it").
- topics.ts is data with a named author and a replacement plan ó its own
  header says the teacher's topic list replaces it, changing no code.

### scripts/ (13 files)

Changed: none. eval.ts's argv-gated --build/run split is the CLI surface
(package.json documents both); method-cards.ts' merge+grounding logic has one
caller (constitution: no abstraction on one caller); review.ts hand-builds
print HTML because it is the only bidi+shaping-capable path (its header
records why reportlab-style libraries fail).

### prisma/ and configs

Changed: none. schema.prisma matches the architecture contract (run 3);
biome.json / next.config.ts / components.json / package.json / .env.example
verified runs 1-3, unchanged since.

### Tests (10 files)

All read across runs 3-4 (this pass: chunk, persian-markdown, ink, normalize).
Real Persian corpus fixtures; the leak-checker strips KaTeX's `<annotation>`
with a comment explaining why it must. 69 tests, all green throughout.

## Decision items (not implemented ó waiting on you)

- **D1 ó prune the vendored kit.** ~560 of prompt-input.tsx's 1470 lines,
  ~270 of message.tsx's 365, ~66 of conversation.tsx's 168, plus
  dialog/separator/textarea/button-group are unreachable from anything
  rendered. Two tiers: (a) safe now ó MessageBranch family, Actions/Toolbar,
  ConversationDownload, Select/HoverCard/Tabs/Command/ActionMenu/Provider
  wrappers, the four ui primitives; (b) keep regardless ó the attachments +
  file-input + screenshot machinery, which is exactly the phase-5 image-upload
  surface (deleting it would make phase 5 harder). Trade-off: pruning makes
  future registry re-syncs a manual merge instead of an overwrite. My lean:
  prune tier (a) when the kit is next touched, not as a stand-alone diff.
- **D2 ó delete ThemeHotkey.** Scaffold demo code; no UI advertises it; but it
  is currently the only way off the "system" theme. If system-only is the
  product intent, it deletes cleanly with `isTypingTarget`.
- **D3 ó history in the general branch (run 3, Rec 4).** My position: pass
  `input.history` through. The no-subject path already streams the full
  `UIMessage[]` (history survives); the pipeline's general branch sends only
  `input.question`, so a follow-up ´????ª classified general inside a subject
  conversation loses context ó the same question behaves differently depending
  on whether a subject is selected. Concrete shape: build the messages array
  from `input.history` + question in the pipeline branch (or take
  `ModelMessage[]` in `streamGeneralAnswer`; the seam test follows). Separate
  and bigger: persisting general chat needs a schema change
  (`Conversation.subjectId` is non-nullable) ó leave until product wants it.
- **D4 ó async scrypt.** `scryptSync` in the login server action blocks the
  event loop ~50ms per attempt. `crypto.scrypt` promisified is the same code
  shape with awaits, and session.test.ts follows. MVP-acceptable as-is; worth
  doing before more than a handful of users.

## Verification results

After each changed file (route.ts, then conversation.tsx):

```
bun run typecheck   ? exit 0
bun run lint        ? exit 0 (89 files)
bun test            ? 69 pass, 0 fail
bun run check:seam  ? "answer seam ok Ö"
bun run build       ? next build ?
bun run eval        ? 33/33 correct option, 33/33 mode, 33/33 topic
```

Plus the settled run-3 item: `bun run cards --apply` (6 cards, 6 approved) ?
`bun run eval` ? **33/33, delta zero**; read-only probe confirms no `\Lambda`
remains in any approved card.
