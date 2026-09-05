# Lessons

Durable rules from audits. Append on future runs; never rewrite. (The ostad
skill's constitution is not restated here — this file only adds to it.)

## UI primitives (Base UI)

- The Base UI menu-item callback gotcha (silent no-op `onSelect` handlers) is
  recorded in the skill's `references/gotchas.md` — read it before binding any
  Base UI component callback.

## AI provider

- Grep the installed provider's `.d.ts` for `@deprecated` before calling any
  factory method — the docs pages lag the types, and that is where
  `textEmbeddingModel → embeddingModel` was caught (@ai-sdk/openai-compatible
  3.x).

## HTTP boundaries

- A Zod schema at the chat boundary must cover everything the first
  downstream transform reads — `convertToModelMessages` reads `parts`, so
  validating only `role` lets malformed bodies through to an unhandled 500
  that bypasses the user-facing Persian error path.

## Persian text in regular expressions

- `\b` is defined on ASCII word characters, so `/^(مثال|تست)\b/` never matches
  `مثال ۱`. The splitter filed every worked problem as prose instead and the
  ingest reported a cheerful `0 exemplars` with no error. Any anchor or
  boundary assertion written against Persian needs a test with real Persian in
  it, not a Latin stand-in.

## Embeddings

- Embedding prefixes are per-model and their absence is silent. `gemini-embedding-2`
  deprecated the `task_type` field (the backend accepts and ignores it) and moved task
  conditioning into the text: `task: search result | query: …` for queries,
  `title: none | text: …` for passages. E5-style `query: `/`passage: ` is a different
  model family's convention — do not carry it across. Keep both sides in one function
  so query and ingest cannot drift, the same discipline the normalizer gets.
- `providerOptions` on `embed`/`embedMany` is keyed by the provider's `name` from
  `createOpenAICompatible`, not by the vendor — here `{ avalai: { dimensions: 768 } }`.
  Verify the returned width rather than trusting a provider default.

## Shell heredocs

- Writing TypeScript through a bash heredoc collapses a double backslash to a single
  one, which silently turns `"\\frac"` into `"\f"` + `rac` — a formfeed escape —
  inside a TS string literal. Use the Write tool for
  files containing LaTeX or regex escapes.

## Regular expressions as data API

- A regex whose matches are read by index (`m[1]`, `[, body]`) treats its capture
  groups as API: converting a capturing group to non-capturing still matches, still
  passes lint, and silently feeds the caller `undefined` — the loop pushes nothing.
  When you change such a pattern, keep the group structure and re-run the positive
  tests, not just the new negative one (the blank-line fix in `chunk.ts` did exactly
  this on its first attempt and only the suite caught it).
- When a regex comment states a boundary the syntax cannot express, the comment loses
  to the syntax silently — prove boundary claims by running the pattern on text that
  contains the boundary (`chunk.ts`'s "does not cross a blank line" didn't).

## PowerShell and shell interop

- Never pass regex or TS snippets through `bun -e "…"` in PowerShell: `$$` is
  interpolated to the process ID and backslash sequences are eaten, so the snippet
  tests something else and returns plausible garbage. Write a temp `.ts` file and
  run it. (Extends the heredoc lesson above.)
- Bun's SQL client rejects Prisma's `?schema=public` query parameter on
  `DATABASE_URL` — strip the query string before `new SQL(url)` in scripts that
  bypass Prisma.

## Pixel oracles need ground truth before they are trusted

- An oracle that checks a model is only worth having if it is itself checked. Calibrating
  the ink oracle against four slides with known content caught two bugs that a plausible
  rule had hidden: white text anti-aliased on a black slide clears any absolute
  channel-spread threshold (fixed by using saturation, a ratio), and printed artwork can
  use the teacher's own pen colours — one lesson slide carries a printed yellow ruler —
  which no colour rule can separate at all. Before the fix, a verified-clean slide scored
  HIGHER than a slide with real handwriting on it.
- The fix for the second bug was to stop measuring colour and start measuring change:
  diff the same slide against an earlier export of itself. Printed artwork cancels; only
  what the teacher added survives. Its blind spot is the mirror image — ink present in
  both snapshots is invisible — and that blind spot produced every false alarm in the
  first real run.
- Corollary: report a disagreement rate, then go and look at the disagreements. Both
  "hallucinations" in the chapter-1 run were the oracle being wrong, not the model. The
  true hallucination rate was zero.

## Annotation is not always writing

- A teacher marking up a slide produces three distinguishable things: new words, marks on
  existing words (circling, underlining, striking through), and nothing. A schema with
  only a "handwriting" field collapses the middle case into the last, so a page dense with
  yellow underlining reads as an extraction failure. The emphasis carries method signal —
  it is the teacher saying which clause matters — and deserves its own field.

## Suspect the harness before the corpus

- The first phase-3 eval scored 26% on four-option questions — indistinguishable from
  guessing. Two defects, both in the harness, neither in the pipeline:
  the eval asked multiple-choice questions **without showing the options**, so the model
  solved the physics correctly and had nothing to name; and the scorer's regex demanded
  the digit immediately after «گزینه», while the model writes «گزینه‌ی درست: ۳». Fixing
  the harness moved the score from 26.3% to 78.9% with no change to prompts, retrieval or
  data. A number near chance is a reason to audit the measurement first.
- Read one full model output before tuning anything. The failure was obvious in ten
  seconds of looking at the text and invisible in the aggregate.

## An eval can be green and still measure the wrong thing

- Ablating retrieval entirely (excluding every exemplar) moved correct-option accuracy by
  one question: 76.3% without the corpus versus 78.9% with it. Retrieval demonstrably
  works — mode goes 0% → 100%, topic 0% → 100% — it just does not change whether the
  answer is right, because a modern model already knows grade-10 physics.
- That is the product's own premise turned into a measurement problem: the differentiator
  is *method*, and correct-option accuracy cannot see method. Any future claim that a
  prompt or retrieval change "improved the answer" needs a method-fidelity score to rest
  on, not this one.

## A defect in extracted data is a pattern, not an incident

- Phase 3's eval reported eight wrong answers. Two of them looked like malformed ground
  truth, and those two were reported as isolated oddities. A manual review found **ten**
  defective records out of thirty-eight — the same three shapes repeating: an option label
  fused to its value («۷/۷۵ ۱»), a value stored where the label belonged («۱/۱»), and
  questions that cannot be answered without a figure the dataset does not carry.
- The rule: when one defect surfaces in extracted data, scan the whole dataset for that
  shape before reporting anything. Repair by rule, not per record — every one of the five
  fused labels was recoverable by the same two regexes, which means a future re-ingest is
  also repaired instead of re-breaking.
- Automation will not find all of them. Three of the five figure-dependent questions never
  use the word «شکل», so no keyword scan surfaces them; only reading the stems does. Where
  a list has to be manual, keep it as an explicit named set with a comment saying why,
  rather than pretending a heuristic covers it.
- Not every anomaly is ours to fix. Two records duplicate an option because the publisher's
  slide really does print «۳۰/۶» twice — verified by re-reading the slide. Flag those and
  leave them; "fixing" them would mean inventing distractors that were never on the page.

## Dead exports are decisions, not accidents

- An export with zero importers past its phase is dead surface, and "it will be
  useful in a later phase" is how it survives three audits. Check with
  `graft callers` (then a ts+tsx grep for what graft does not index) before
  deleting; if the count is zero, delete the function or drop the `export` �
  restoring two lines when the feature lands is cheaper than carrying surface
  nobody reads (`searchChunks`, `ModelRole`, `tokensUsedInWindow` all sat
  through two runs on plausibility alone).

## The third copy of a constant is the signal to promote it

- When a constant or helper exists in lib and is re-defined in two scripts, the
  scripts are the ones that will drift � a fix lands in lib, the scripts keep
  the old copy, and the defect returns with a different file in the stack trace.
  Promote at the third definition, into the module that owns the domain
  (`PERSIAN_DIGITS` lived in options.ts, eval.ts and review.ts; the option
  domain owned it).

## Verify a comment's mechanism claim the way you would verify code

- A comment that asserts a mechanism ("a real scrypt hash of a value nobody
  has") is a testable claim: decode the constant, run the pattern, check the
  docs. The DUMMY_HASH key decoded to `bogus` repeated � the timing property it
  protected was real, the stated mechanism was not, and a future reader would
  have "learned" a false invariant from it.

## Content artifacts are prompts

- `content/derived/method-cards.md` is loaded verbatim into answer prompts by
  `cards --apply`, so a junk formula in it is a prompt defect, not a typo � and
  the grounding-removal step can miss a variant of a claim it already flagged
  (the flags file condemned ? while the card kept it). After editing the file,
  the database copy is immediately stale: every file fix implies a pending
  `cards --apply` plus an eval re-run, and the pair should be named in the same
  breath.

## The installed compiler answers Tailwind questions in one minute

- Do not carry an "unverified" Tailwind variant across audits when
  `@tailwindcss/postcss` is in node_modules: point `@source` at a sample HTML
  file, compile, and read the emitted CSS. `rtl:-translate-x-[-50%]` resolved to
  `calc(-50% * -1)` under `:where(:dir(rtl), �)` � provable, not arguable.
  (Keep the temp CSS inside the project; the plugin resolves `tailwindcss`
  relative to the CSS file.)

## A smell in the render body may be the library's intended pattern

- `transport: new DefaultChatTransport({...})` inside a component re-rendered on
  every stream delta looks like allocation churn begging for `useMemo`. Reading
  the installed hook source settled it: `useChat` writes the transport into a
  `latestRef` every render and reads it at send time, and the Chat instance is
  not recreated on identity change � the fresh object with fresh closures is the
  design. Before wrapping a constructor call in `useMemo`, check whether the
  library stores it in a ref-for-latest-value; a dependency array there adds a
  staleness hazard for zero gain. (@ai-sdk/react 4.x, dist/index.js, `useChat`.)

## Check the premise's scope before executing it

- A brief that says "review the ~40 vendored files" when the directory holds 3
  means the author has not looked either � every downstream claim inherits the
  error. `ls` the scope first and correct the number in the report; findings
  are only as good as the enumeration they enumerate.

## A carried recommendation needs a closing trigger, not just a repeat

- The English `ConversationEmptyState` defaults rode three runs as a
  recommendation while the fix was a two-line edit with zero risk. When a
  recommendation survives a run, write next to it exactly what blocks it
  (behaviour change? decision? cost?) and what closes it � "recommended" alone
  is how known-cleanups become permanent fixtures.
