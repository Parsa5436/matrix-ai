# Data strategy — turning the institute's material into the knowledge base

Decision document. No code was written this session. Every measurement below was taken
from the files in `./content/` with PyMuPDF or from the configured VLM; every external
claim is cited.

**Recommendation in one line:** the teacher's annotated slide is already the finished
artifact — extract from it directly with a VLM, use a model-free ink measurement as the
correctness oracle, and treat the booklet and the video as enrichment, not as inputs.

---

## 1. What is actually in `./content/`

Verified, not assumed. Several things in the brief are wrong.

### Inventory

| File | Pages | Text layer | Background | Teacher ink |
| --- | --- | --- | --- | --- |
| `Tamland_Booklet_2025-07-26` | 16 | yes, ~1278 ch/pg | light (248) | n/a |
| `..._Tamland_Booklet_2025_08_09` | 26 | yes, ~1210 ch/pg | light (248) | n/a |
| `Fasle 1(Kamel)` (E3/E4/E5) | 101 | **none** (0–3 ch/pg) | dark (43) | 40/101 pages |
| `Fasle 2 …Bakhshe 1` (E5) | 110 | none | dark (40) | 6/110 pages |
| `Andazegiri S1-15` (E1/E2/E3) | 58 | trace (19–64 ch/pg) | dark (43) | 47/58 pages |
| `black note` (E1–E5) | 50 | none | near-black (5–20) | negligible |

### Corrections to the brief

**There are two different booklets, not one.** 16 pages (26 July) and 26 pages
(9 August). The 26-page file is a superset — its first 16 pages have an identical
blank-run profile — so it supersedes the other.

**E1–E5 are cumulative for the slide decks — confirmed — but not for `black note`.**
Measuring ink deviation on fixed pages across versions:

```
Fasle 1(Kamel)    E3 [128,103,150,100,121,105]
                  E4 [128,103,150,108,121,146]   <- gains ink
                  E5 [128,103,150,108,121,146]   <- identical to E4
Andazegiri        E1 [153,103,150] E2 [153,110,150] E3 [153,110,167]  <- monotonic
black note        E1 106 -> E2 34 -> E3 46 -> E4 31 -> E5 6           <- NOT cumulative
```

So: keep **E5** for `Fasle 1` and `Fasle 2`, **E3** for `Andazegiri`. `black note` is a
per-session whiteboard that is different each time and almost entirely empty — it is the
one file that would need all five archives, and it is also the one file worth nothing.
Discard it.

**E5 contains chapter 2**, not just chapter 1. The material is further along than the
brief states, though chapter 2 is only 6/110 pages taught.

**"Zero occurrences of تست" is correct, but the conclusion drawn from it is not.** The
booklet contains `تست` 0 times — *and* `مثال` 19 times, `پاسخ` 4, `گزینه` 7, `حل` 8. The
booklet is organised around worked **examples**, not numbered tests. The test numbers live
in the slide deck.

**The booklet's text layer is far more damaged than "formulas are destroyed".** The
formula corruption is real and worse than the example given — `2.99792458×10⁸` extracts as
`299792458`, and `3.64×10⁻²` as `3 92740 0`. But the *prose* is corrupted too, and
systematically:

| Correct Persian | occurrences | Corrupted form | occurrences |
| --- | --- | --- | --- |
| `معمولاً` | 0 | `معموال` | 3 |
| `اولاً` | 0 | `اوال` | 3 |
| `حالا` | 0 | `حاال` | 3 |
| `اصلاً` | 0 | `اصال` | 6 |

Every lam-alef ligature is decomposed in the wrong order — a 100% failure rate, not an
occasional glitch. Separately, 111 of 237 sentence-final periods are misplaced *before*
the final word (`می.شود` for `می‌شود.`). This is the classic RTL run-ordering failure in
PDF text extraction. **The booklet's text layer cannot be used as text.** Anything built
on it needs OCR anyway — at which point the text layer contributes nothing.

**The slides do contain step-by-step worked solutions.** This is the most consequential
correction. The brief says the deck has "the correct option circled and wrong options
struck through, but no step-by-step worked solution." That is not what is there.

`Fasle 1` p.95 (تست ۴۶, a unit-conversion problem) carries: a margin note `یکای جرم : kg`
with an arrow to `SI` in the question stem; the correct option circled; and a complete
solution — a proportion table (`قیراط | m.gr`, `۱ | ۲۰۰`, `۱۸۲ | m = ۳۶۴۰۰`), then the
conversion chain `۳۶۴۰۰ × ۱۰⁻³/۱۰³ = ۳۶۴۰۰ × ۱۰⁻⁶ kg`, then `۳٫۶۴ × ۱۰⁻² kg`.

`Andazegiri` p.45 (مثال ۷, significant figures) is richer still: outliers struck through
and labelled `دورازذهن` ("implausible"), valid readings ticked, `اعشار دهم` circled, the
mean computed, the conditional rule written out — `اگر مرتبه‌ها یکی نبود (گرد کنیم)` — and
the final answer boxed in a second ink colour, `عدد گزارش شده = ۱۲٫۷ (m)`.

That is not an answer key. That is the method, in his hand, in his own vocabulary,
including the heuristics he uses to decide what to discard.

### Page census

Header-banner clustering plus a colour-based ink measure over the three decks:

```
Fasle 1 (E5)      101 pages, 40 annotated (40%) — ink is contiguous from p.53 onward
Fasle 2 (E5)      110 pages,  6 annotated (5%)  — chapter 2 barely begun
Andazegiri (E3)    58 pages, 47 annotated (81%) — essentially fully taught
```

**~93 annotated slides exist today.** That is the entire method-signal corpus. It is small,
and section 4 argues that is a feature rather than a problem.

---

## 2. Can a VLM actually read these slides?

I ran three real slides through the configured model (Gemini via OpenRouter) asking for
slide kind, printed text, handwriting, filled blanks, marked answer, and method steps.

- **p.40** (`درسنامه`, no handwriting): printed Persian extracted verbatim and *correctly* —
  `مثلاً` with the ligature intact, which the booklet's own text layer gets wrong.
  `handwriting: ""`. A clean negative control.
- **p.60** (`نکته`, one filled blank): recovered the printed sentence with its dotted blank
  and paired it with what the teacher wrote into it —
  `همواره مقدار ماده (جرم) تغییر نکرده و ثابت می‌ماند`.
- **p.95** (`تست`): transcribed the proportion table, the conversion chain in LaTeX, the
  marked answer (4 — correct), and reconstructed three ordered method steps matching the
  teacher's actual sequence.

The transcription is reading, not reconstruction from physics knowledge: it reproduced the
teacher's redundant `× ۱۰⁻³/۱۰³` form rather than the `× 10⁻⁶` a model solving from scratch
would write.

Two caveats. Three slides is a probe, not an evaluation — section 6 is the real experiment.
And published handwriting benchmarks put frontier VLMs at CER ≈ 0.31 on hard free-text
handwriting ([handwriting-to-structured-data benchmark, 2026](https://arxiv.org/pdf/2604.16504)),
so error rates on the worst slides will be materially higher than these three suggest.
Specialised document models such as [dots.ocr](https://arxiv.org/pdf/2512.02498) beat
general VLMs on table and formula parsing, and are worth testing if the VLM proves weak on
the dense algebra pages — but they do not do the printed/handwritten separation or the
method-step reasoning we actually need, so they would be a component, not a replacement.

---

## 3. The options, scored

Axes: **quality** (does it reproduce the method), **eng** (build cost and fragility),
**institute** (recurring work forever), **failure** (loud or silent).

### A — Booklet-driven OCR, joined to the deck by test number

| Axis | Verdict |
| --- | --- |
| Quality | **Poor.** The booklet is the *unfilled* skeleton. Its blanks are exactly the method. |
| Eng | **High.** Text layer unusable → full OCR; then a join whose key does not exist. |
| Institute | Low — they already produce it. |
| Failure | **Silent.** A bad join attaches the wrong answer to the right question. |

The join is the fatal part. The brief proposes joining on test number; the booklet contains
`تست` zero times, so the key is not in the text at all. A join on OCR'd graphics is a
similarity match, and a similarity match that silently mispairs a question with another
question's answer is the worst failure this product can have. **Reject.**

### B — Slide-driven VLM extraction

| Axis | Verdict |
| --- | --- |
| Quality | **High.** Question, method, and answer are co-located on one page, in his hand. |
| Eng | **Low.** Render page → VLM → Zod → existing phase-2 pipeline. No join. |
| Institute | **Near zero.** One file they already produce (§5). |
| Failure | **Loud, if instrumented** (see below). |

The decisive property is that **no join is required**. The slide is the atomic unit: the
printed question and the teacher's solution are spatially bound on the same page because he
wrote one onto the other. Every other option has to reassemble what this one never takes
apart.

### C — Video-driven: transcribe, align to slides, derive method

| Axis | Verdict |
| --- | --- |
| Quality | **High ceiling, lossy path.** Spoken reasoning is real signal; two lossy stages precede it. |
| Eng | **High.** ASR + diarisation + slide alignment + segment attribution. |
| Institute | **Medium.** Recordings must be exported, stored, and shipped — GBs per session. |
| Failure | **Silent.** A misaligned segment attaches the wrong explanation to the right slide. |

Persian ASR is the first loss. The [PSRB benchmark (arXiv 2505.21230)](https://arxiv.org/abs/2505.21230)
evaluates ten systems on Persian and reports:

| System | CER | WER |
| --- | --- | --- |
| **Avanegar** (Iranian, `api.ivira.ai`) | **8.75%** | **19.3%** |
| Google Chirp v2 | 9.05% | 19.92% |
| Aipa (Iranian, `aipaa.ir`) | 10.43% | — |
| Faster-Whisper | best open-source, "significantly fewer hallucinations" than Whisper | |

PSRB's own conclusion is that commercial systems beat open-source on Persian because
open-source models have thin Persian fine-tuning data, and that Whisper and Seamless "are
prone to hallucination errors" on Persian. ~19% WER on clean speech is before you add a
classroom, a whiteboard marker, and technical vocabulary.

Alignment is the second loss. [MaViLS (Interspeech 2024)](https://www.isca-archive.org/interspeech_2024/anderer24_interspeech.pdf)
benchmarks video-to-slide alignment and reports 0.82 accuracy for a multimodal algorithm
against 0.56 for SIFT — and notes that **OCR features contribute the most** to matching
accuracy. That is the tell: the best way to align audio to a slide is to read the slide.
If we are reading the slide anyway, the slide is the primary source and the audio is a
commentary track on it.

Stacking ~0.81 transcription against ~0.82 alignment gives roughly two-thirds end-to-end
fidelity per segment, with both failures silent. **Not as the primary path.**

Pricing, for when we do want audio ([Google](https://cloud.google.com/speech-to-text/pricing),
[OpenAI](https://costbench.com/software/ai-transcription-apis/openai-whisper/),
[Azure](https://brasstranscripts.com/blog/azure-speech-services-pricing-2025-microsoft-ecosystem-costs)):
Whisper API $0.36/hr, Azure batch $0.18/hr, Google Chirp batch $0.18/hr, self-hosted
Faster-Whisper ~free at our volume. At ~2 hr/session this is rounding error either way —
**cost is not what decides this axis; fidelity and failure mode are.** Note also that
Avanegar is Iranian-hosted, which matters under the constitution's egress rule: it is the
one option on this list that does not cross the border.

### D — What we should actually do

**The annotated slide is the finished artifact. Build the corpus from it, and make the
failure loud with a model-free oracle.**

Concretely, all three knowledge layers derive from one pass over the deck:

- **Solved exemplars** ← annotated `تست` / `مثال` slides. Question, options, marked answer,
  and the worked method all come from the same page.
- **Method cards** ← synthesised per topic from that topic's annotated slides. This is a
  change from `rag-contract.md`, which drafts them "from the notes"; the notes are the
  unfilled skeleton, and the method is in the ink.
- **Raw chunks** ← printed `درسنامه` slides, VLM-transcribed. These are cleaner than the
  booklet's own text layer, as p.40 demonstrated.

The addition that makes B into D is the **ink oracle**. Teacher annotation is drawn in
saturated green/cyan/yellow over white-and-blue printed material on black. A pixel count —
no model, no inference — tells us objectively whether a slide has handwriting on it. That
gives a cross-check the VLM cannot talk its way around:

- VLM returns handwriting on a slide the oracle says is clean → **hallucination, flag it**.
- Oracle says a slide is heavily annotated and the VLM returns little or nothing →
  **extraction failure, flag it**.

That converts option B's one real weakness — a VLM confabulating a plausible physics
solution that the teacher never wrote — from silent into loud. It costs about fifteen lines
and is the reason I prefer D over plain B.

The booklet keeps exactly one job: a **printed-text prior**. It is corrupt as text but its
page order and section headings are intact, and they give the chapter/topic taxonomy the
slides lack. It supplies structure, not content.

The video keeps one job too, deferred: **phase 6 needs his voice for TTS anyway**, and the
recordings are the only source of it. When we fetch them for voice, we get the transcripts
as a by-product and can enrich the method cards then — against an exemplar corpus that
already exists and can be diffed. That is the right order: build the reliable layer first,
add the lossy layer second, and measure whether it helped.

---

## 4. Why a small corpus is the right target

The instinct that ~93 slides is "not enough data" should be resisted. The evidence says
style and method alignment is a low-data problem, and that curation beats volume.

[LIMA](https://arxiv.org/pdf/2311.13133) aligned a model with roughly **1,000** curated
prompt-response pairs and beat training on far larger, noisier sets; the finding
generalises to multimodal alignment in [MM-LIMA](https://arxiv.org/pdf/2308.12067), which
reports the same effect at ~200 instructions. Surveys of instruction tuning conclude that
[diversity and quality matter more than sheer volume](https://dl.acm.org/doi/10.1145/3777411).

For *retrieval*-based style transfer the requirement is lower still. Few-shot style work
finds that a handful of exemplars — [1–5 per class](https://arxiv.org/pdf/2010.03802) —
suffices to steer style, and that in-context exemplars avoid the per-author model that
fine-tuning demands ([STYLL / low-resource authorship transfer](https://arxiv.org/pdf/2212.08986)).
Since our pipeline already retrieves 2–4 exemplars per answer, ~93 worked problems is not a
thin corpus — it is roughly 25 retrievable exemplars per topic.

The honest counterweight: LLMs still [struggle to imitate implicit personal
style](https://arxiv.org/html/2509.14543v1), and fine-tuning often captures surface
mannerisms while missing deeper traits. That is an argument for exemplars carrying *worked
reasoning* rather than a prose "style prompt" — which is exactly what an annotated slide is,
and exactly what a style description of him would not be.

The closest published analogue, [AI University (arXiv 2504.08846)](https://arxiv.org/abs/2504.08846),
went the other way and is instructive. They generated **4,648 QA pairs** from a course's
textbook, notes, coding examples, and lecture videos, LoRA-fine-tuned LLaMA-3.2-11B into
"LLaMA-TOMMI-1.0", and combined it with RAG. Human evaluators preferred it about twice as
often as the base model, and the instructor judged it better aligned to course content.
Two things to take from it: RAG-plus-synthesis did real work alongside the fine-tune, and
they needed a *generated* corpus an order of magnitude larger than ours because they were
fine-tuning. We are not. **We should not fine-tune yet** — not until an eval says retrieval
has run out of room.

---

## 5. What the institute must do after each session

**One step.**

> Upload the latest `…Fasle N (Kamel).pdf` after the session.

That is the whole protocol, and it requires no new work, because the file already exists and
they already maintain it. The cumulative-ink measurement in §1 proves it: E3 → E4 → E5 are
the same 101-page document with progressively more ink. It is their own running artifact,
saved at the end of each session. They send the newest one; we ingest it as a new
`corpusVersion`; the previous version keeps serving until the new one is verified.

Because the file is cumulative, a missed week is self-healing — the next upload contains it.
There is no per-session bookkeeping, no naming convention to get wrong, no join key to
maintain, and nothing to reconcile. `black note` should be dropped from the hand-off
entirely; it is near-empty and, unlike the decks, would require every session's copy.

Video, when we start collecting it for TTS, adds a second step (upload the recording) and
should be introduced only when phase 6 needs it.

---

## 6. The cheapest experiment that would falsify this

**Cost: roughly $2 of model calls and about two hours, one of them the teacher's.**

1. Render the ~93 annotated slides at 110 dpi. Run each through the VLM with the schema
   from §2. (~$1–3, one pass.)
2. Compute the ink oracle for all 211 slides across the three decks and cross-check against
   the VLM's `handwriting` field. **Report the disagreement rate.** This needs no human and
   no ground truth.
3. Sample 20 extracted exemplars at random and put them in front of the teacher with one
   question: *"Is this how you solved it?"* — a yes/no per slide, plus a note where it is no.

**Commit if** method fidelity ≥ 85% on the teacher's 20, and the ink-oracle disagreement
rate is under ~5%. **Abandon B/D if** the teacher rejects more than a quarter — that would
mean the ink is not self-sufficient and the spoken track is load-bearing, which promotes
option C from enrichment to necessity.

Step 3 is the one that matters and the one that cannot be skipped. Steps 1–2 measure whether
we read the slide correctly; only the teacher can say whether reading the slide correctly is
the same as capturing his method. Note that this also produces the first real eval set, which
phase 3 needs regardless of the outcome.

---

## 7. What this changes in the ostad skill

Two documented decisions do not survive contact with the real material. Both are in
`references/rag-contract.md`.

**The ingest input contract is wrong for this corpus.** Phase 2 ingests Markdown files and
begins by validating `$…$` with KaTeX — reasonable when the client's material was described
as "already clean Markdown". It is not. It is a dark-background PDF with no text layer. The
three-layer knowledge model, `corpusVersion`, the normalizer, subject-filtered retrieval,
and the flag-don't-drop rule all survive intact; **the input adapter does not**. The
splitter's assumption that boundaries are headings (`مثال`/`تست` markers in text) must become
"the slide page is the chunk boundary". This is an adapter change in front of an otherwise
unchanged pipeline, which is the outcome the phase-2 design was built for — but it should be
written down rather than discovered again.

**Method cards should be drafted from the annotated slides, not from the notes.**
`rag-contract.md` says the `fast` model drafts them "from the notes". The notes are the
skeleton with the blanks still in it. The method is in the ink. The `teacherApproved` gate
becomes more important, not less, because the drafting source is now an OCR of handwriting.

One thing I would *not* change: the no-reranker decision holds. With ~25 exemplars per topic
after subject and topic filtering, the candidate pool is small enough that a reranker would
add latency and a dependency for a gain no eval could currently detect.

---

## 8. What I could not determine

**Whether the slides alone are sufficient, or the spoken track is load-bearing.** I can show
the ink contains a complete method on the slides I inspected. I cannot show it does so
*consistently*, and I cannot know what he says while writing that never reaches the page —
the "why this shortcut" that is often the whole point. Only §6 step 3 settles this, and it
needs the teacher, not more analysis.

**Real VLM accuracy at corpus scale.** Three slides is a probe. The dense-algebra pages in
the 53–99 range are visibly harder than the three I sampled, and published handwriting CER
of ~0.31 suggests the tail will be worse than the head. §6 step 1–2 settles it.

**Why `Fasle 1` pages 0–39 carry no ink** while 53–99 do. Either those pages are pure
`درسنامه` with nothing to fill, or the early sessions were annotated in a file we do not
have. If the latter, there is missing material and someone should ask. A five-minute look at
the deck with the teacher would resolve it.

**Whether Avanegar is reachable and affordable from the institute's network**, and whether
its 19.3% WER holds on classroom audio rather than benchmark audio. PSRB does not test
lecture conditions. This only matters once video work starts.

**Whether chapter 2 will follow the same annotation pattern.** It is 6/110 pages in — too
early to tell whether the 40%-annotated shape of chapter 1 is typical or an artifact of how
far that chapter got.
