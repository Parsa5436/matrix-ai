# AI layer

## The one rule

Every model call goes through `lib/ai/provider.ts`. No vendor SDK import, no
`fetch` to a model URL, anywhere else in the codebase. The provider owns the
base URL, the key, retry, failover, and metering — a direct call silently
bypasses all four.

## Provider setup

We reach Gemini through **AvalAI**, an OpenAI-compatible gateway, because the
Google API is not reachable from Iranian infrastructure and AvalAI settles in
Rial. YaraBot is the configured fallback.

```ts
// lib/ai/provider.ts
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

const primary = createOpenAICompatible({
  name: "avalai",
  baseURL: process.env.AI_BASE_URL!,
  apiKey: process.env.AI_API_KEY!,
});
```

Read the installed `@ai-sdk/openai-compatible` docs before writing this — the
factory's exact return shape is version-sensitive and has changed across AI SDK
majors. Do not write it from memory.

**Failover:** the provider exposes one function that tries primary, and on a
network or 5xx error retries once against the fallback base URL. Do not fail
over on 4xx — a bad request will be bad at both providers, and retrying it
doubles the bill for nothing.

**YaraBot's path differs from the OpenAI convention** (`/chat/completion`,
singular). If you wire it, pass a custom `fetch` that rewrites the path rather
than editing the shared provider.

## Model roles

Name roles, not models, so a model swap is one line in `models.ts`:

| Role | Used for |
| --- | --- |
| `reasoning` | final answer generation, vision |
| `fast` | classification, topic detection, ingestion extraction |
| `embedding` | chunk and query vectors |

Confirm the exact model ids against AvalAI's live model list, not Google's docs
— resellers typically lag one or two versions behind upstream, and an id that
exists at Google may 404 here.

## Structured output

**Do not depend on `response_format` / `json_schema`.** Resellers may not proxy
it. The documented idiom is:

1. Prompt for JSON, explicitly: no prose, no markdown fences.
2. Strip fences defensively anyway.
3. `Schema.safeParse`.
4. On failure, retry **once** with the validation error appended to the prompt.
5. On second failure, throw a typed error the caller handles.

Every structured shape lives in `lib/ai/schemas.ts`. If a schema is used in one
place only, it still goes there — one home for model contracts is what makes
them auditable.

## Streaming

The route handler adapts HTTP to the pipeline and nothing else:

```ts
// app/api/chat/route.ts
export const runtime = "nodejs";   // Edge cannot do pg or long streams
export const maxDuration = 60;
```

Consume `answer()`'s async iterable and forward it. No business logic in the
handler.

**Latency expectation:** the request path is Iran → AvalAI → model. Time to
first token is normally 1–3s. Never render a bare spinner for that window —
show streaming state, and on failure show an explicit "service unavailable"
message rather than hanging. Third-party outages are the client's risk under
the contract, but a silent hang is our bug.

## Vision

Images go in as base64 data URIs through the OpenAI-compatible message shape.

Two rules that matter for answer quality:

- **Keep the original image in the final generation call.** Transcribed text is
  not enough for geometry, graphs, or diagrams. Extraction is an aid, not a
  replacement.
- **Compress client-side first** — max ~1600px on the long edge. A raw phone
  photo is several megabytes of tokens for no accuracy gain.

Verify that AvalAI actually proxies image input before building on it. Some
gateways pass text only, and the failure mode is a confident answer about
nothing.

## Metering

Every call records `{ userId, role, promptTokens, completionTokens }`. This is
not optional bookkeeping: clause 8 of the contract puts third-party cost on the
client, and without a counter we can neither invoice it nor stop one student
from uploading two hundred photos.

Enforce a per-user daily quota at the provider boundary, not in the UI.

## Prompt assembly

Prompts are built in `lib/answer/assemble.ts` from data, never hand-concatenated
at the call site. The assembled message list is always:

```
system:  teacher persona (from the teacher record)
system:  method card for the detected topic
user:    2–4 retrieved solved exemplars, as worked examples
user:    the student's question (+ image if present)
```

Keep prompts in template files or exported constants, not inline in the middle
of logic. When the eval score moves, you need to be able to diff the prompt.
