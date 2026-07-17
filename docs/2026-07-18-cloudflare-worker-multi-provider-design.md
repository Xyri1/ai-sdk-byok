# Design: Multi-provider chat in the Cloudflare Worker example

- **Date:** 2026-07-18
- **Status:** Approved design, pending implementation plan
- **Goal:** `examples/cloudflare-worker` should let users chat through any of the AI SDK's official providers plus OpenRouter, matching the provider coverage already shipped in `examples/nextjs-supabase`.

## Summary

The Cloudflare Worker example currently wires exactly one provider (`openai`, hardcoded model id) into `POST /api/chat`. `examples/nextjs-supabase` already solved the general problem — a shared provider table, a live model-listing endpoint, and a streaming chat route that switches on the stored key's `provider` string. This change ports that pattern into the Worker example, adapted for Hono/Workers and the example's vanilla HTML/JS frontend (no React/Next runtime available here).

This is example-app scope only. No changes to `packages/core`, `packages/cloudflare`, or their public API/security invariants — `provider` is already an opaque application-defined string per `AGENTS.md`, and neither package needs to know which providers an integrator wires up.

## Decisions Made During Brainstorming

1. **Full parity with `nextjs-supabase`**, not a lighter subset — same 9-entry provider list (OpenAI, Anthropic, DeepSeek, xAI, Groq, Mistral, Cohere, OpenRouter, generic OpenAI-compatible), same live `/api/models` listing, same streaming chat. Chosen so the two examples stay consistent and either can serve as the canonical reference.
2. **OpenRouter and the generic OpenAI-compatible endpoint both route through `createOpenAI({ apiKey, baseURL, name })`** with a different `baseURL` — they are not separate AI SDK provider packages, matching how `nextjs-supabase/app/api/chat/route.ts` already does it.
3. **New provider dependencies pinned to the major that satisfies this package's existing `ai@^7.0.22` peer requirement** — checked against the npm registry (current latest majors: `@ai-sdk/anthropic`, `@ai-sdk/cohere`, `@ai-sdk/groq`, `@ai-sdk/mistral`, `@ai-sdk/xai` on `4.x`; `@ai-sdk/deepseek` on `3.x`), not copied verbatim from `nextjs-supabase/package.json` (that example pins several providers to older majors resolved against a different, unpinned `ai` version).
4. **`OPENAI_COMPATIBLE_BASE_URL` is delivered via `.dev.vars`** (like `BYOK_MASTER_KEY`), not `wrangler.jsonc` `vars` — keeps one env-var delivery mechanism for the example instead of splitting config across two files.

## Architecture

### New module: `examples/cloudflare-worker/src/providers.ts`

Ports `examples/nextjs-supabase/lib/providers.ts` to the Worker's `Env`:

```ts
export const supportedProviders = [ /* 9 entries: value + label */ ] as const;
export type SupportedProvider = (typeof supportedProviders)[number]['value'];
export function isSupportedProvider(value: string): value is SupportedProvider;
export function getProviderLabel(value: string): string;

export function getModelEndpoint(
  provider: SupportedProvider,
  apiKey: string,
): { url: string; headers: HeadersInit; providerLabel: string };
// Same per-provider `/models` URLs and auth header shapes as the Next.js
// version (Anthropic: `x-api-key` + `anthropic-version`; everyone else:
// `Authorization: Bearer`). `openai-compatible` needs a base URL, so this
// function takes it as a parameter here instead of reading `process.env`
// (not available in Workers) — see the chat route below for the caller.

export function createModel(
  provider: SupportedProvider,
  apiKey: string,
  modelId: string,
  openaiCompatibleBaseURL?: string,
): LanguageModelV3;
// Switches on provider to call the matching `create<Provider>({ apiKey })`.
// `openrouter` and `openai-compatible` both go through
// `createOpenAI({ apiKey, baseURL, name })` with different `baseURL`s.
```

### `src/index.ts` changes

- `Env` gains `OPENAI_COMPATIBLE_BASE_URL?: string`.
- `POST /api/chat`: drop the `record.provider !== 'openai'` guard. Validate via `isSupportedProvider`. Request body gains a `model` field (replaces the hardcoded `MODEL_ID` constant). Build the model via `createModel(...)`, passing `c.env.OPENAI_COMPATIBLE_BASE_URL` through. Switch `generateText` → `streamText`, return `result.toTextStreamResponse()`.
- `GET /api/models` (new): reads `keyId` from the query string, looks up the stored key, 404s if missing, 400s if `!isSupportedProvider`, then calls `getModelEndpoint` and proxies the provider's model-list call. Response is normalized with the same `normalizeModels` logic as `nextjs-supabase/app/api/models/route.ts` (handles `{data:[...]}`, `{models:[...]}`, and bare-array response shapes across providers) — ported into `providers.ts` alongside the rest of the module rather than duplicated inline in the route.

### `public/index.html` changes

- Provider `<select>` gets all 9 options generated from the same value/label pairs as `supportedProviders` (hardcoded in the page script, mirroring how the single `openai` option is hardcoded today — no new endpoint needed just to serve a static list).
- New model `<select>`, repopulated via `fetch('/api/models?keyId=...')` whenever the selected key changes — vanilla-JS equivalent of `ProviderModelField`.
- Chat submit switches from `await response.json()` to a `ReadableStream` reader loop appending decoded chunks to `#answer` as they arrive.
- A short static note appears when `openai-compatible` is selected, explaining that `OPENAI_COMPATIBLE_BASE_URL` must be set in `.dev.vars` — no client-side base-URL input, since that stays server-side config in both examples.

## Testing

`test/e2e.test.ts` keeps its existing OpenAI happy-path test (proves the core security invariant: the stored key reaches the provider, unmodified) and adds:

- **Anthropic chat** — proves the provider switch actually branches (different auth header shape: `x-api-key`, not `Authorization: Bearer`), not just that OpenAI still works.
- **OpenRouter chat** — proves the request lands on `openrouter.ai`, not `api.openai.com`.
- **OpenAI-compatible chat** — proves `OPENAI_COMPATIBLE_BASE_URL` routing, with the env var set on the test's worker `Env`.
- **Unsupported provider rejection** — `POST /api/chat` with a key saved under a provider string outside `supportedProviders` returns 400.
- **`/api/models`** — mocked provider `/models` response in one of the supported response shapes, asserting the normalized `{ id, name }[]` list.

No changes to `test/apply-migrations.ts` or the D1 migration — this feature touches only key retrieval and provider construction, not storage.

## Docs

`examples/cloudflare-worker/README.md` "Run locally" and "What to copy" sections get updated to describe the multi-provider setup and the new `OPENAI_COMPATIBLE_BASE_URL` optional var, matching the wording already in `examples/nextjs-supabase/README.md`. No changes to `AGENTS.md`, `docs/architecture.md`, or any `specs/00N-*` — this is example-app behavior, not a package public-API, security-posture, or runtime-support change.

## Out of Scope

- Any change to `packages/core`, `packages/supabase`, or `packages/cloudflare` public APIs or validation rules.
- Bringing the Next.js example's `openai-compatible` base-URL validation error messages or logging (`lib/logger.ts`) into the Worker example — the Worker example has no equivalent logging module today and this change doesn't add one.
- Non-chat AI SDK capabilities (image generation, embeddings, transcription) or official providers whose credential shape isn't a single API key (Azure OpenAI, Amazon Bedrock, Google Vertex) — out of scope both because they don't fit this project's `{ apiKey: string }`-only credential shape (`AGENTS.md` Scope) and because `nextjs-supabase`, the parity target, doesn't wire them either.
