# Ostad — Project Specification

## What we are building

A Persian, RTL chatbot for students. A student picks their subject, types a
question or uploads a photo of a test problem, and gets an answer worked out
**the way their own teacher solves it** — drawn from that teacher's notes,
selected examples, and solving style. Later, a speaker button reads the answer
aloud.

## Scope

**In scope**
- Persian RTL chat with conversation history, deep-linkable conversations
- General conversation, routed to a model
- Educational questions, routed to a retrieval-backed pipeline
- Image input: photograph a question, get it solved
- Answers that follow the teacher's method, and say so explicitly when they
  cannot
- Citations back to the source notes
- Standard Persian text-to-speech, played per message
- Multi-subject, multi-teacher from day one

**Out of scope unless separately agreed**
- Fine-tuning or training a base model
- Cloned teacher voice (conditional on the client supplying voice samples and
  legal permission)
- Payments, parent dashboards, analytics for teachers
- Mobile apps

## Constraints that shape every decision

**Deployment is inside Iran.** App, database, and object storage are domestic.
Model calls reach Gemini through AvalAI, an OpenAI-compatible reseller, with
YaraBot as fallback. International egress is a dependency that can fail, and the
UI must degrade honestly rather than hang.

**Source material is already clean Markdown.** The client converted the notes
from PDF and cleaned them with a model. This removes the largest risk in the
project but introduces a new one: model-cleaned math can be valid and wrong.
Ingestion validates before trusting.

**Multiple subjects, probably multiple teachers.** Subject is a first-class
dimension in the schema, in retrieval, and in the prompt. Persona and voice hang
off the teacher record, not off global config.

## Architecture in one paragraph

Next.js only — no separate backend service. AI Elements (a shadcn registry, so
the component source lives in our repo) for the chat surface, `useChat` from the
AI SDK for state and streaming. All model access flows through one provider
module pointed at AvalAI. The answer pipeline is a pure, HTTP-free function that
classifies, retrieves, assembles a prompt, and streams a structured result.
Postgres with pgvector holds both application data and the knowledge base,
accessed through Prisma, with vector reads confined to one raw-SQL file.

## The knowledge model

Three layers, kept separate on purpose:

1. **Method cards** — per topic, the teacher's approach stated explicitly.
   Teacher-approved, injected into the prompt directly.
2. **Solved exemplars** — structured records of worked problems, retrieved by
   similarity and used as few-shot examples. This is what actually transfers
   style.
3. **Raw chunks** — notes and textbook text, for definitions and formulas.

Plain chunk-based RAG over the notes does not reproduce a teacher's method;
style does not survive chunking. The three-layer split is the core design bet of
the project.

## Acceptance criteria

- A student selects a subject, asks a question, and gets a streamed answer that
  cites the notes and states whether it used the teacher's method
- The same works from a photograph of a printed or handwritten question
- Answers in the eval set hit an agreed accuracy threshold per subject
- Conversations persist and are reachable by URL
- Adding a new subject is data entry plus an ingest run — no code changes
- Every model call is metered against a user, with a daily quota enforced
- Every user-facing string is Persian, RTL, with formulas rendering correctly
  inside RTL prose

## Contract mapping

| Contract clause | Where it lands |
| --- | --- |
| 3-1 Persian RTL chat UI | Phase 1 |
| 3-2 model API for general conversation | Phase 1 |
| 3-3 routing educational questions to a dedicated backend | Phase 3 |
| 3-4 use of the client's teaching materials | Phase 2 |
| 3-5 answer in the teacher's method | Phase 3 |
| 3-6 fall back to a standard method, stated explicitly | Phase 3 — the `mode` field |
| 3-7 prompt engineering / RAG / knowledge base permitted | Phases 2–3 |
| 3-8 text-to-speech via a voice API | Phase 6 |
| 3-9 cloned teacher voice, conditional | Out of scope until samples and permission arrive |

Clause 3-8 asks for speech, not specifically the teacher's voice — cloning is
conditional in clause 9. Standard Persian TTS satisfies the deliverable and is a
few hours of work; treat cloning as a separate, later, client-gated item.

## Open items to settle with the client

1. Does each subject have a different teacher? This multiplies persona records
   and, later, voice cloning cost and effort.
2. Payment amount, deposit percentage, and **the revision count in clause 7** —
   currently blank, which means unlimited revisions.
3. Written agreement that preparing and cleaning source material is the client's
   responsibility, or billed separately.
4. Who holds the AvalAI account and pays for tokens (clause 8 says the client).
