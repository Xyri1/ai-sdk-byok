# Cloudflare Worker Example Multi-Provider Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `examples/cloudflare-worker` supports the same provider set as `examples/nextjs-supabase` — OpenAI, Anthropic, DeepSeek, xAI, Groq, Mistral, Cohere, OpenRouter, and a generic OpenAI-compatible endpoint — with live per-provider model listing and streaming chat, instead of the single hardcoded `openai` + `gpt-5-mini` wiring it has today.

**Architecture:** A new `src/providers.ts` module (ported from `examples/nextjs-supabase/lib/providers.ts`) centralizes the provider table, per-provider `/models` endpoint metadata, model-list response normalization, and AI SDK client construction. `src/index.ts`'s `POST /api/chat` switches from `generateText` to `streamText` and drops its single-provider guard; a new `GET /api/models` route proxies each provider's model list. `public/index.html` gains a model `<select>` and a streaming-aware chat submit handler.

**Tech Stack:** Hono, AI SDK v7 (`ai@^7.0.22`) with `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/cohere`, `@ai-sdk/deepseek`, `@ai-sdk/groq`, `@ai-sdk/mistral`, `@ai-sdk/xai`, Vitest + `@cloudflare/vitest-pool-workers` (real workerd).

**Spec:** `docs/2026-07-18-cloudflare-worker-multi-provider-design.md` (approved). Read it before starting.

---

## Global Constraints

- Scope is `examples/cloudflare-worker` only. No changes to `packages/core`, `packages/supabase`, `packages/cloudflare`, `AGENTS.md`, or any `specs/00N-*` — `provider` is already an opaque application-defined string (`AGENTS.md` Scope), and this change only exercises that existing contract from the example app.
- `isSupportedProvider` gates `POST /api/chat` and `GET /api/models` only. `POST /api/keys` (save) keeps accepting any provider string, unchanged — matches `examples/nextjs-supabase`, where the same asymmetry exists (the UI's `<select>` only offers supported values, but nothing in the save path enforces it server-side).
- Chat responses move from `generateText` (`c.json({ text })`) to `streamText` (`result.toTextStreamResponse()`). This changes the wire format the mocked `fetch` in tests must satisfy: providers built on `createOpenAI` (openai, openrouter, openai-compatible) expect a `text/event-stream` body of `data: {...}` chat-completion-chunk lines terminated by `data: [DONE]`; Anthropic expects its own `event: .../data: ...` message-stream format. The exact payloads below were verified by running `streamText` against each installed provider package (`@ai-sdk/openai@4.0.16`, `@ai-sdk/anthropic@4.0.16`, `ai@7.0.31`) with a mocked `fetch` and confirming the decoded text — copy them verbatim.
- `OPENAI_COMPATIBLE_BASE_URL` is optional Worker config, not a secret: delivered via `.dev.vars` for local dev (same mechanism as `BYOK_MASTER_KEY`) and via a fixed `miniflare.bindings` value in `vitest.config.ts` for tests.
- Conventional Commits, lowercase types. Commit after each task.

---

### Task 1: Provider dependencies and `OPENAI_COMPATIBLE_BASE_URL` plumbing

No behavior change yet — this task only adds the packages and the env var surface later tasks depend on.

**Files:**
- Modify: `examples/cloudflare-worker/package.json`
- Modify: `examples/cloudflare-worker/src/index.ts` (just the `Env` interface)
- Modify: `examples/cloudflare-worker/.dev.vars.example`
- Modify: `examples/cloudflare-worker/vitest.config.ts`

- [ ] **Step 1: Add the provider packages to `dependencies`**

In `examples/cloudflare-worker/package.json`, the `dependencies` block currently reads:

```json
  "dependencies": {
    "@ai-sdk-byok/cloudflare": "0.2.0",
    "@ai-sdk/openai": "^4.0.11",
    "ai": "^7.0.22",
    "ai-sdk-byok": "0.2.0",
    "hono": "^4.12.29"
  },
```

Replace it with:

```json
  "dependencies": {
    "@ai-sdk-byok/cloudflare": "0.2.0",
    "@ai-sdk/anthropic": "^4.0.16",
    "@ai-sdk/cohere": "^4.0.11",
    "@ai-sdk/deepseek": "^3.0.12",
    "@ai-sdk/groq": "^4.0.12",
    "@ai-sdk/mistral": "^4.0.13",
    "@ai-sdk/openai": "^4.0.11",
    "@ai-sdk/xai": "^4.0.16",
    "ai": "^7.0.22",
    "ai-sdk-byok": "0.2.0",
    "hono": "^4.12.29"
  },
```

(These are the current npm-registry-latest majors for each package; all declare the same `zod: "^3.25.76 || ^4.1.8"` peer range as the already-installed `@ai-sdk/openai`, so they resolve alongside it without conflict.)

- [ ] **Step 2: Install and verify**

Run: `npm install`
Expected: installs the 6 new packages under `examples/cloudflare-worker/node_modules/@ai-sdk/`, no peer dependency conflicts reported, `package-lock.json` updates.

- [ ] **Step 3: Add `OPENAI_COMPATIBLE_BASE_URL` to `Env`**

In `examples/cloudflare-worker/src/index.ts`, change:

```ts
export interface Env {
  DB: D1Database;
  BYOK_CACHE: KVNamespace;
  BYOK_MASTER_KEY: string;
}
```

to:

```ts
export interface Env {
  DB: D1Database;
  BYOK_CACHE: KVNamespace;
  BYOK_MASTER_KEY: string;
  OPENAI_COMPATIBLE_BASE_URL?: string;
}
```

- [ ] **Step 4: Document the optional var in `.dev.vars.example`**

`examples/cloudflare-worker/.dev.vars.example` currently reads:

```
# Generate with: openssl rand -base64 32
BYOK_MASTER_KEY="replace-with-generated-key"
```

Append:

```
# Generate with: openssl rand -base64 32
BYOK_MASTER_KEY="replace-with-generated-key"

# Only needed if you save a key under the "OpenAI-compatible" provider.
# OPENAI_COMPATIBLE_BASE_URL="https://your-openai-compatible-host/v1"
```

- [ ] **Step 5: Add the test binding**

In `examples/cloudflare-worker/vitest.config.ts`, change:

```ts
          bindings: {
            // Test-only master key: base64 of 32 bytes of 0x07.
            BYOK_MASTER_KEY: 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=',
            TEST_MIGRATIONS: migrations,
          },
```

to:

```ts
          bindings: {
            // Test-only master key: base64 of 32 bytes of 0x07.
            BYOK_MASTER_KEY: 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=',
            OPENAI_COMPATIBLE_BASE_URL: 'https://openai-compatible.test/v1',
            TEST_MIGRATIONS: migrations,
          },
```

- [ ] **Step 6: Verify nothing broke**

Run: `npm run typecheck -w examples/cloudflare-worker && npm run test -w examples/cloudflare-worker`
Expected: typecheck passes; all existing tests in `test/e2e.test.ts` still pass (the `Env` addition is optional, and the new binding is unused so far).

- [ ] **Step 7: Commit**

```bash
git add examples/cloudflare-worker/package.json examples/cloudflare-worker/package-lock.json examples/cloudflare-worker/src/index.ts examples/cloudflare-worker/.dev.vars.example examples/cloudflare-worker/vitest.config.ts package-lock.json
git commit -m "feat(examples): add provider dependencies for cloudflare worker example"
```

(If `npm install` only touched the root `package-lock.json`, drop the per-workspace lockfile path above — workspaces share one lockfile at the repo root; `git status` after Step 2 shows which paths actually changed.)

---

### Task 2: `src/providers.ts` — provider table, model listing, client construction

**Files:**
- Create: `examples/cloudflare-worker/src/providers.ts`

- [ ] **Step 1: Write the module**

```ts
import { createAnthropic } from '@ai-sdk/anthropic';
import { createCohere } from '@ai-sdk/cohere';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createGroq } from '@ai-sdk/groq';
import { createMistral } from '@ai-sdk/mistral';
import { createOpenAI } from '@ai-sdk/openai';
import { createXai } from '@ai-sdk/xai';
import type { LanguageModelV3 } from '@ai-sdk/provider';

export const supportedProviders = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'xai', label: 'xAI' },
  { value: 'groq', label: 'Groq' },
  { value: 'mistral', label: 'Mistral' },
  { value: 'cohere', label: 'Cohere' },
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'openai-compatible', label: 'OpenAI-compatible' },
] as const;

export type SupportedProvider = (typeof supportedProviders)[number]['value'];

const supportedProviderValues = new Set<string>(supportedProviders.map((provider) => provider.value));

export function isSupportedProvider(value: string): value is SupportedProvider {
  return supportedProviderValues.has(value);
}

export interface ModelEndpoint {
  url: string;
  headers: HeadersInit;
  providerLabel: string;
}

export function getModelEndpoint(
  provider: SupportedProvider,
  apiKey: string,
  openaiCompatibleBaseURL?: string,
): ModelEndpoint {
  const bearerHeaders = {
    Accept: 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };

  switch (provider) {
    case 'openai':
      return { url: 'https://api.openai.com/v1/models', headers: bearerHeaders, providerLabel: 'OpenAI' };
    case 'anthropic':
      return {
        url: 'https://api.anthropic.com/v1/models',
        headers: {
          Accept: 'application/json',
          'anthropic-version': '2023-06-01',
          'x-api-key': apiKey,
        },
        providerLabel: 'Anthropic',
      };
    case 'deepseek':
      return { url: 'https://api.deepseek.com/models', headers: bearerHeaders, providerLabel: 'DeepSeek' };
    case 'xai':
      return { url: 'https://api.x.ai/v1/models', headers: bearerHeaders, providerLabel: 'xAI' };
    case 'groq':
      return { url: 'https://api.groq.com/openai/v1/models', headers: bearerHeaders, providerLabel: 'Groq' };
    case 'mistral':
      return { url: 'https://api.mistral.ai/v1/models', headers: bearerHeaders, providerLabel: 'Mistral' };
    case 'cohere':
      return { url: 'https://api.cohere.com/v2/models', headers: bearerHeaders, providerLabel: 'Cohere' };
    case 'openrouter':
      return { url: 'https://openrouter.ai/api/v1/models', headers: bearerHeaders, providerLabel: 'OpenRouter' };
    case 'openai-compatible': {
      if (!openaiCompatibleBaseURL) {
        throw new Error('OPENAI_COMPATIBLE_BASE_URL is required for OpenAI-compatible model listing');
      }

      return {
        url: `${openaiCompatibleBaseURL.replace(/\/$/, '')}/models`,
        headers: bearerHeaders,
        providerLabel: 'OpenAI-compatible',
      };
    }
  }
}

export function createModel(
  provider: SupportedProvider,
  apiKey: string,
  modelId: string,
  openaiCompatibleBaseURL?: string,
): LanguageModelV3 {
  switch (provider) {
    case 'openai':
      return createOpenAI({ apiKey }).chat(modelId);
    case 'anthropic':
      return createAnthropic({ apiKey })(modelId);
    case 'deepseek':
      return createDeepSeek({ apiKey }).chat(modelId);
    case 'xai':
      return createXai({ apiKey }).chat(modelId);
    case 'groq':
      return createGroq({ apiKey })(modelId);
    case 'mistral':
      return createMistral({ apiKey }).chat(modelId);
    case 'cohere':
      return createCohere({ apiKey })(modelId);
    case 'openrouter':
      return createOpenAI({ apiKey, baseURL: 'https://openrouter.ai/api/v1', name: 'openrouter' }).chat(modelId);
    case 'openai-compatible': {
      if (!openaiCompatibleBaseURL) {
        throw new Error('OPENAI_COMPATIBLE_BASE_URL is required for OpenAI-compatible chat');
      }

      return createOpenAI({ apiKey, baseURL: openaiCompatibleBaseURL, name: 'openai-compatible' }).chat(modelId);
    }
  }
}

export interface ModelOption {
  id: string;
  name: string;
}

interface ModelRecord {
  id?: unknown;
  name?: unknown;
  model?: unknown;
  slug?: unknown;
  display_name?: unknown;
  displayName?: unknown;
}

export function normalizeModels(payload: unknown): ModelOption[] {
  const records = readModelRecords(payload);
  const seen = new Set<string>();
  const models: ModelOption[] = [];

  for (const record of records) {
    const id =
      readString(record.id) ?? readString(record.name) ?? readString(record.model) ?? readString(record.slug);

    if (!id || seen.has(id)) {
      continue;
    }

    seen.add(id);
    models.push({
      id,
      name: readString(record.display_name) ?? readString(record.displayName) ?? readString(record.name) ?? id,
    });
  }

  return models.sort((first, second) => first.name.localeCompare(second.name));
}

function readModelRecords(payload: unknown): ModelRecord[] {
  if (Array.isArray(payload)) {
    return payload.filter(isModelRecord);
  }

  if (!isRecord(payload)) {
    return [];
  }

  const models = payload.models;
  if (Array.isArray(models)) {
    return models.filter(isModelRecord);
  }

  const data = payload.data;
  if (Array.isArray(data)) {
    return data.filter(isModelRecord);
  }

  return [];
}

function isModelRecord(value: unknown): value is ModelRecord {
  return isRecord(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
```

This module has no dedicated unit test file — `examples/cloudflare-worker` only has `test/e2e.test.ts` (real-workerd integration tests), matching `examples/nextjs-supabase`, which also has no unit tests for its equivalent `lib/providers.ts`. `createModel` and `getModelEndpoint` are exercised end-to-end by the tests added in Tasks 3 and 4.

- [ ] **Step 2: Verify it compiles**

Run: `npm run typecheck -w examples/cloudflare-worker`
Expected: PASS. (The module isn't imported anywhere yet, so this only checks the file's own types — `noUnusedLocals`-style errors would not fire since every export is, in fact, exported.)

- [ ] **Step 3: Commit**

```bash
git add examples/cloudflare-worker/src/providers.ts
git commit -m "feat(examples): add provider table and model-listing helpers for cloudflare worker example"
```

---

### Task 3: Multi-provider streaming chat

**Files:**
- Modify: `examples/cloudflare-worker/src/index.ts`
- Modify: `examples/cloudflare-worker/test/e2e.test.ts`

- [ ] **Step 1: Update the test file for the new contract (red)**

Replace the full contents of `examples/cloudflare-worker/test/e2e.test.ts` with:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import worker, { type Env } from '../src/index';

const workerEnv = env as unknown as Env;

const OPENAI_STYLE_SSE = [
  `data: {"id":"chatcmpl-mock","object":"chat.completion.chunk","created":1752710400,"model":"gpt-5-mini","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}`,
  '',
  `data: {"id":"chatcmpl-mock","object":"chat.completion.chunk","created":1752710400,"model":"gpt-5-mini","choices":[{"index":0,"delta":{"content":"Hello from the mock"},"finish_reason":null}]}`,
  '',
  `data: {"id":"chatcmpl-mock","object":"chat.completion.chunk","created":1752710400,"model":"gpt-5-mini","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":4,"total_tokens":5}}`,
  '',
  'data: [DONE]',
  '',
].join('\n');

const ANTHROPIC_SSE = [
  `event: message_start`,
  `data: {"type":"message_start","message":{"id":"msg_mock","type":"message","role":"assistant","model":"claude-mock","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":1,"output_tokens":0}}}`,
  '',
  `event: content_block_start`,
  `data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}`,
  '',
  `event: content_block_delta`,
  `data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello from the mock"}}`,
  '',
  `event: content_block_stop`,
  `data: {"type":"content_block_stop","index":0}`,
  '',
  `event: message_delta`,
  `data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":4}}`,
  '',
  `event: message_stop`,
  `data: {"type":"message_stop"}`,
  '',
].join('\n');

function sseResponse(body: string): Response {
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

async function call(path: string, init?: RequestInit): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await worker.fetch(new Request(`http://example.com${path}`, init), workerEnv, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

function json(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

async function saveKey(apiKey: string, provider = 'openai'): Promise<{ id: string }> {
  const response = await call('/api/keys', json({ provider, apiKey }));
  expect(response.status).toBe(201);
  return (await response.json()) as { id: string };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('cloudflare worker example end to end', () => {
  it('saves a key and returns metadata only', async () => {
    const response = await call('/api/keys', json({ provider: 'openai', apiKey: 'sk-mock-1234' }));

    expect(response.status).toBe(201);
    const body = await response.text();
    expect(body).not.toContain('sk-mock-1234');
    expect(JSON.parse(body)).toMatchObject({ provider: 'openai', label: 'default', keyHint: '1234' });
  });

  it('rejects invalid input with a 400', async () => {
    const response = await call('/api/keys', json({ provider: '', apiKey: '' }));
    expect(response.status).toBe(400);
  });

  it('lists metadata only', async () => {
    await saveKey('sk-mock-1234');

    const response = await call('/api/keys');
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).not.toContain('sk-mock-1234');
    expect((JSON.parse(body) as unknown[]).length).toBe(1);
  });

  it('returns 404 from chat for an unknown key id', async () => {
    const response = await call('/api/chat', json({ keyId: crypto.randomUUID(), model: 'gpt-5-mini', prompt: 'hi' }));
    expect(response.status).toBe(404);
  });

  it('rejects chat for a key saved under an unsupported provider', async () => {
    const { id } = await saveKey('sk-mock-1234', 'made-up-provider');

    const response = await call('/api/chat', json({ keyId: id, model: 'whatever', prompt: 'hi' }));
    expect(response.status).toBe(400);
  });

  it('chat streams text using the stored openai key', async () => {
    const { id } = await saveKey('sk-mock-1234');

    let capturedAuthorization: string | null = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = new Request(input as RequestInfo, init);
      const url = new URL(request.url);

      if (url.origin === 'https://api.openai.com' && url.pathname === '/v1/chat/completions' && request.method === 'POST') {
        capturedAuthorization = request.headers.get('authorization');
        return sseResponse(OPENAI_STYLE_SSE);
      }

      throw new Error(`Unexpected fetch: ${request.method} ${request.url}`);
    });

    const response = await call('/api/chat', json({ keyId: id, model: 'gpt-5-mini', prompt: 'Say hello' }));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('Hello from the mock');
    expect(capturedAuthorization).toBe('Bearer sk-mock-1234');
  });

  it('chat routes anthropic keys through the anthropic client', async () => {
    const { id } = await saveKey('sk-ant-mock-5678', 'anthropic');

    let capturedApiKeyHeader: string | null = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = new Request(input as RequestInfo, init);
      const url = new URL(request.url);

      if (url.origin === 'https://api.anthropic.com' && url.pathname === '/v1/messages' && request.method === 'POST') {
        capturedApiKeyHeader = request.headers.get('x-api-key');
        return sseResponse(ANTHROPIC_SSE);
      }

      throw new Error(`Unexpected fetch: ${request.method} ${request.url}`);
    });

    const response = await call('/api/chat', json({ keyId: id, model: 'claude-mock', prompt: 'Say hello' }));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('Hello from the mock');
    expect(capturedApiKeyHeader).toBe('sk-ant-mock-5678');
  });

  it('chat routes openrouter keys to the openrouter host', async () => {
    const { id } = await saveKey('sk-or-mock-1234', 'openrouter');

    let capturedOrigin: string | null = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = new Request(input as RequestInfo, init);
      const url = new URL(request.url);

      if (url.origin === 'https://openrouter.ai' && url.pathname === '/api/v1/chat/completions' && request.method === 'POST') {
        capturedOrigin = url.origin;
        return sseResponse(OPENAI_STYLE_SSE);
      }

      throw new Error(`Unexpected fetch: ${request.method} ${request.url}`);
    });

    const response = await call('/api/chat', json({ keyId: id, model: 'openrouter-mock', prompt: 'Say hello' }));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('Hello from the mock');
    expect(capturedOrigin).toBe('https://openrouter.ai');
  });

  it('chat routes openai-compatible keys to OPENAI_COMPATIBLE_BASE_URL', async () => {
    const { id } = await saveKey('sk-compat-mock-1234', 'openai-compatible');

    let capturedUrl: string | null = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = new Request(input as RequestInfo, init);

      if (request.url === 'https://openai-compatible.test/v1/chat/completions' && request.method === 'POST') {
        capturedUrl = request.url;
        return sseResponse(OPENAI_STYLE_SSE);
      }

      throw new Error(`Unexpected fetch: ${request.method} ${request.url}`);
    });

    const response = await call('/api/chat', json({ keyId: id, model: 'compat-mock', prompt: 'Say hello' }));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('Hello from the mock');
    expect(capturedUrl).toBe('https://openai-compatible.test/v1/chat/completions');
  });

  it('delete removes the key, is idempotent, and chat stops working', async () => {
    const { id } = await saveKey('sk-mock-1234');

    expect((await call(`/api/keys/${id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await call(`/api/keys/${id}`, { method: 'DELETE' })).status).toBe(204);

    const list = (await (await call('/api/keys')).json()) as unknown[];
    expect(list).toEqual([]);
    expect((await call('/api/chat', json({ keyId: id, model: 'gpt-5-mini', prompt: 'hi' }))).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run the tests to confirm the expected failures**

Run: `npm run test -w examples/cloudflare-worker`
Expected: FAIL. The renamed/new provider tests fail because `src/index.ts` still only accepts `provider === 'openai'` and returns `c.json({ text })` instead of a stream — e.g. `chat streams text using the stored openai key` fails because `response.text()` is `'{"text":"Hello from the mock"}'`-shaped JSON, not `'Hello from the mock'` (and the old mock never gets exercised the same way). The unsupported-provider and multi-provider tests fail with 400s coming from the old `record.provider !== 'openai'` guard message rather than the new one, or with "Unexpected fetch" errors since the old code never calls `https://api.anthropic.com` etc.

- [ ] **Step 3: Implement the route (green)**

In `examples/cloudflare-worker/src/index.ts`, replace the whole file with:

```ts
import { AiSdkByokValidationError, cachedStorage, createByokManager } from 'ai-sdk-byok';
import { d1Adapter, kvCredentialCache } from '@ai-sdk-byok/cloudflare';
import { streamText } from 'ai';
import { Hono } from 'hono';
import { createModel, getModelEndpoint, isSupportedProvider, normalizeModels } from './providers';

export interface Env {
  DB: D1Database;
  BYOK_CACHE: KVNamespace;
  BYOK_MASTER_KEY: string;
  OPENAI_COMPATIBLE_BASE_URL?: string;
}

// Demo identity. In a real app derive the user id from your session
// layer (e.g. better-auth) — never from browser-provided input.
const DEMO_USER_ID = 'demo-user';

function createManager(env: Env) {
  return createByokManager({
    storage: cachedStorage({
      storage: d1Adapter({ database: env.DB, encryptionKey: env.BYOK_MASTER_KEY }),
      cache: kvCredentialCache({ namespace: env.BYOK_CACHE, encryptionKey: env.BYOK_MASTER_KEY }),
      ttlMs: 60_000,
    }),
  });
}

const app = new Hono<{ Bindings: Env }>();

app.get('/api/keys', async (c) => {
  const keys = await createManager(c.env).keys.list({ userId: DEMO_USER_ID });
  return c.json(keys);
});

app.post('/api/keys', async (c) => {
  const body = await c.req.json<{ provider?: string; label?: string; apiKey?: string }>();

  try {
    const metadata = await createManager(c.env).keys.save({
      userId: DEMO_USER_ID,
      provider: body.provider ?? '',
      ...(body.label ? { label: body.label } : {}),
      credentials: { apiKey: body.apiKey ?? '' },
    });
    return c.json(metadata, 201);
  } catch (error) {
    if (error instanceof AiSdkByokValidationError) {
      return c.json({ error: error.message }, 400);
    }
    throw error;
  }
});

app.delete('/api/keys/:id', async (c) => {
  await createManager(c.env).keys.delete({ userId: DEMO_USER_ID, keyId: c.req.param('id') });
  return c.body(null, 204);
});

app.get('/api/models', async (c) => {
  const keyId = c.req.query('keyId') ?? '';

  if (!keyId) {
    return c.json({ error: 'keyId is required' }, 400);
  }

  const record = await createManager(c.env).keys.getById({ userId: DEMO_USER_ID, keyId });

  if (record === null) {
    return c.json({ error: 'No stored key for this id' }, 404);
  }

  if (!isSupportedProvider(record.provider)) {
    return c.json({ error: 'Choose a supported provider key' }, 400);
  }

  try {
    const endpoint = getModelEndpoint(record.provider, record.credentials.apiKey, c.env.OPENAI_COMPATIBLE_BASE_URL);
    const response = await fetch(endpoint.url, { headers: endpoint.headers });

    if (!response.ok) {
      return c.json({ error: `${endpoint.providerLabel} models could not be loaded` }, 502);
    }

    return c.json({ models: normalizeModels(await response.json()) });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Models could not be loaded' }, 400);
  }
});

app.post('/api/chat', async (c) => {
  const body = await c.req.json<{ keyId?: string; model?: string; prompt?: string }>();

  if (!body.keyId || !body.model || !body.prompt) {
    return c.json({ error: 'keyId, model, and prompt are required' }, 400);
  }

  const record = await createManager(c.env).keys.getById({ userId: DEMO_USER_ID, keyId: body.keyId });

  if (record === null) {
    return c.json({ error: 'No stored key for this id' }, 404);
  }

  if (!isSupportedProvider(record.provider)) {
    return c.json({ error: 'Choose a supported provider key' }, 400);
  }

  try {
    // The plaintext credential never leaves this handler; the browser gets model text only.
    const model = createModel(record.provider, record.credentials.apiKey, body.model, c.env.OPENAI_COMPATIBLE_BASE_URL);
    const result = streamText({ model, prompt: body.prompt });

    return result.toTextStreamResponse();
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : 'The chat request could not be completed' },
      400,
    );
  }
});

export default app;
```

(`GET /api/models` is implemented here alongside the chat route change because both depend on the same `record`/`isSupportedProvider` shape and this keeps the file in one coherent state between commits; Task 4 below adds its dedicated tests and treats the route as already-implemented for its red/green cycle on those tests specifically.)

- [ ] **Step 4: Run the tests again**

Run: `npm run test -w examples/cloudflare-worker`
Expected: PASS — all tests in `test/e2e.test.ts` green, including the 6 provider-routing tests.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck -w examples/cloudflare-worker`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add examples/cloudflare-worker/src/index.ts examples/cloudflare-worker/test/e2e.test.ts
git commit -m "feat(examples): stream multi-provider chat in the cloudflare worker example"
```

---

### Task 4: `GET /api/models` dedicated test

The route was implemented in Task 3 (it shares the `record`/`isSupportedProvider` plumbing with the chat route and splitting its implementation out would leave the file in an inconsistent in-between state). This task adds the test that specifically pins down its response-normalization behavior, which Task 3's tests don't cover.

**Files:**
- Modify: `examples/cloudflare-worker/test/e2e.test.ts`

- [ ] **Step 1: Write the test**

Add this `it` block inside the `describe('cloudflare worker example end to end', ...)` block in `examples/cloudflare-worker/test/e2e.test.ts`, after the `'delete removes the key...'` test:

```ts
  it('lists normalized models for the selected key provider', async () => {
    const { id } = await saveKey('sk-mock-1234');

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(input as string);

      if (url.origin === 'https://api.openai.com' && url.pathname === '/v1/models') {
        return new Response(
          JSON.stringify({
            object: 'list',
            data: [
              { id: 'gpt-5-mini', object: 'model' },
              { id: 'gpt-5', object: 'model' },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    const response = await call(`/api/models?keyId=${id}`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      models: [
        { id: 'gpt-5', name: 'gpt-5' },
        { id: 'gpt-5-mini', name: 'gpt-5-mini' },
      ],
    });
  });

  it('returns 400 from models listing when keyId is missing', async () => {
    const response = await call('/api/models');
    expect(response.status).toBe(400);
  });
```

- [ ] **Step 2: Run the tests**

Run: `npm run test -w examples/cloudflare-worker`
Expected: PASS (the route already exists from Task 3 — this step is confirmation, not a red/green cycle for the route itself, only for these two specific assertions about normalization and the missing-`keyId` guard).

- [ ] **Step 3: Commit**

```bash
git add examples/cloudflare-worker/test/e2e.test.ts
git commit -m "test(examples): cover model list normalization in the cloudflare worker example"
```

---

### Task 5: Frontend — provider select, model select, streaming chat

**Files:**
- Modify: `examples/cloudflare-worker/public/index.html`

- [ ] **Step 1: Replace the file**

Replace the full contents of `examples/cloudflare-worker/public/index.html` with:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ai-sdk-byok — Cloudflare example</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 640px; margin: 2rem auto; padding: 0 1rem; }
    fieldset { border: 1px solid #ccc; border-radius: 8px; margin-bottom: 1.5rem; }
    label { display: block; margin: 0.5rem 0 0.25rem; }
    input, select, button, textarea { font: inherit; padding: 0.4rem; }
    table { width: 100%; border-collapse: collapse; }
    td, th { text-align: left; padding: 0.3rem; border-bottom: 1px solid #eee; }
    #answer { white-space: pre-wrap; background: #f6f6f6; border-radius: 8px; padding: 0.75rem; min-height: 2rem; }
    .error { color: #b00020; }
    .hint { color: #555; font-size: 0.85em; margin: 0.25rem 0 0; }
  </style>
</head>
<body>
  <h1>Bring your own key</h1>
  <p>Keys are sealed with AES-256-GCM before touching D1/KV. The browser only ever sees metadata.</p>

  <fieldset>
    <legend>Save a key</legend>
    <form id="save-form">
      <label for="provider">Provider</label>
      <select id="provider">
        <option value="openai">OpenAI</option>
        <option value="anthropic">Anthropic</option>
        <option value="deepseek">DeepSeek</option>
        <option value="xai">xAI</option>
        <option value="groq">Groq</option>
        <option value="mistral">Mistral</option>
        <option value="cohere">Cohere</option>
        <option value="openrouter">OpenRouter</option>
        <option value="openai-compatible">OpenAI-compatible</option>
      </select>
      <p id="openai-compatible-hint" class="hint" style="display: none">
        Requires <code>OPENAI_COMPATIBLE_BASE_URL</code> to be set in <code>.dev.vars</code>.
      </p>
      <label for="label">Label (optional)</label>
      <input id="label" placeholder="default" />
      <label for="apiKey">API key</label>
      <input id="apiKey" type="password" required placeholder="sk-..." />
      <p><button type="submit">Save</button> <span id="save-error" class="error"></span></p>
    </form>
  </fieldset>

  <fieldset>
    <legend>Your keys</legend>
    <table>
      <thead><tr><th></th><th>Provider</th><th>Label</th><th>Hint</th><th>Updated</th><th></th></tr></thead>
      <tbody id="key-rows"></tbody>
    </table>
  </fieldset>

  <fieldset>
    <legend>Chat with the selected key</legend>
    <form id="chat-form">
      <label for="model">Model</label>
      <select id="model" disabled>
        <option value="">Choose a saved key first</option>
      </select>
      <label for="prompt">Prompt</label>
      <textarea id="prompt" rows="3" style="width: 100%" placeholder="Say hello"></textarea>
      <p><button type="submit">Send</button> <span id="chat-error" class="error"></span></p>
    </form>
    <div id="answer"></div>
  </fieldset>

  <script>
    const keyRows = document.getElementById('key-rows');
    const providerSelect = document.getElementById('provider');
    const openaiCompatibleHint = document.getElementById('openai-compatible-hint');
    const modelSelect = document.getElementById('model');
    let selectedKeyId = null;

    providerSelect.onchange = () => {
      openaiCompatibleHint.style.display = providerSelect.value === 'openai-compatible' ? 'block' : 'none';
    };

    async function refreshModels(keyId) {
      if (!keyId) {
        modelSelect.innerHTML = '<option value="">Choose a saved key first</option>';
        modelSelect.disabled = true;
        return;
      }

      modelSelect.disabled = true;
      modelSelect.innerHTML = '<option value="">Loading models…</option>';

      try {
        const response = await fetch(`/api/models?keyId=${encodeURIComponent(keyId)}`);
        if (!response.ok) throw new Error('models request failed');
        const { models } = await response.json();

        if (models.length === 0) {
          modelSelect.innerHTML = '<option value="">No models available</option>';
          return;
        }

        modelSelect.innerHTML = '';
        for (const model of models) {
          const option = document.createElement('option');
          option.value = model.id;
          option.textContent = model.name;
          modelSelect.append(option);
        }
        modelSelect.disabled = false;
      } catch {
        modelSelect.innerHTML = '<option value="">Models unavailable</option>';
      }
    }

    async function refreshKeys() {
      const keys = await (await fetch('/api/keys')).json();
      if (!keys.some((key) => key.id === selectedKeyId)) selectedKeyId = keys[0]?.id ?? null;
      keyRows.innerHTML = '';
      for (const key of keys) {
        const row = document.createElement('tr');
        row.innerHTML = `
          <td><input type="radio" name="selected" ${key.id === selectedKeyId ? 'checked' : ''}></td>
          <td>${key.provider}</td><td>${key.label}</td><td>…${key.keyHint}</td>
          <td>${new Date(key.updatedAt).toLocaleString()}</td>
          <td><button type="button">Delete</button></td>`;
        row.querySelector('input').onchange = () => {
          selectedKeyId = key.id;
          refreshModels(selectedKeyId);
        };
        row.querySelector('button').onclick = async () => {
          await fetch(`/api/keys/${key.id}`, { method: 'DELETE' });
          refreshKeys();
        };
        keyRows.append(row);
      }
      refreshModels(selectedKeyId);
    }

    document.getElementById('save-form').onsubmit = async (event) => {
      event.preventDefault();
      const errorEl = document.getElementById('save-error');
      errorEl.textContent = '';
      const response = await fetch('/api/keys', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: providerSelect.value,
          label: document.getElementById('label').value || undefined,
          apiKey: document.getElementById('apiKey').value,
        }),
      });
      if (!response.ok) {
        errorEl.textContent = (await response.json()).error ?? 'Save failed';
        return;
      }
      document.getElementById('apiKey').value = '';
      refreshKeys();
    };

    document.getElementById('chat-form').onsubmit = async (event) => {
      event.preventDefault();
      const errorEl = document.getElementById('chat-error');
      const answerEl = document.getElementById('answer');
      errorEl.textContent = '';
      answerEl.textContent = '';

      const modelId = modelSelect.value;
      if (!modelId) {
        errorEl.textContent = 'Choose a model';
        return;
      }

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          keyId: selectedKeyId,
          model: modelId,
          prompt: document.getElementById('prompt').value,
        }),
      });

      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => ({}));
        errorEl.textContent = body.error ?? 'Chat failed';
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        answerEl.textContent += decoder.decode(value, { stream: true });
      }
    };

    refreshKeys();
  </script>
</body>
</html>
```

- [ ] **Step 2: Manually verify in a browser**

```bash
cp .dev.vars.example .dev.vars   # then set BYOK_MASTER_KEY=$(openssl rand -base64 32)
npm run dev -w examples/cloudflare-worker
```

Open the printed local URL and:
1. Confirm the provider `<select>` lists all 9 options, and that choosing "OpenAI-compatible" shows the `.dev.vars` hint.
2. Save a real OpenAI key (or any provider you have a key for). Confirm the model dropdown populates after saving (proves `GET /api/models` round-trips against the live provider, not just the mocked tests).
3. Send a chat prompt and confirm the answer streams in incrementally rather than appearing all at once.
4. Delete the key and confirm the model dropdown reverts to "Choose a saved key first".

This step has no automated equivalent in this repo (no browser/DOM test tooling here) — it's the only verification for the HTML/JS changes, so don't skip it.

- [ ] **Step 3: Commit**

```bash
git add examples/cloudflare-worker/public/index.html
git commit -m "feat(examples): add provider/model selection and streaming chat UI"
```

---

### Task 6: Docs and final verification

**Files:**
- Modify: `examples/cloudflare-worker/README.md`

- [ ] **Step 1: Update the README**

Replace the full contents of `examples/cloudflare-worker/README.md` with:

```markdown
# ai-sdk-byok — Cloudflare Worker example

Runnable end-to-end example of `@ai-sdk-byok/cloudflare`: a Hono Worker with a key-management UI and a streaming chat endpoint that constructs an AI SDK provider from the user's stored key, entirely server-side. Supports OpenAI, Anthropic, DeepSeek, xAI, Groq, Mistral, Cohere, OpenRouter, and any OpenAI-compatible endpoint.

## Run locally (no Cloudflare account needed)

```sh
cp .dev.vars.example .dev.vars           # then set BYOK_MASTER_KEY=$(openssl rand -base64 32)
npm install
npm run dev -w examples/cloudflare-worker
```

`wrangler dev` applies the D1 migration locally and serves the UI. Save a key, watch the list stay metadata-only, pick a live model from the dropdown, and chat using your own provider key.

If you select the "OpenAI-compatible" provider, also set `OPENAI_COMPATIBLE_BASE_URL` in `.dev.vars` to your endpoint's base URL (e.g. `https://your-host/v1`) before saving a key under that provider.

## Tests

`npm run test -w examples/cloudflare-worker` runs the end-to-end suite inside real workerd (`@cloudflare/vitest-pool-workers`): local D1/KV bindings, migrations applied in setup, and outbound provider calls intercepted to prove the saved key reaches the right provider for OpenAI, Anthropic, OpenRouter, and a mocked OpenAI-compatible endpoint.

## What to copy into a real app

- The `createManager` composition in `src/index.ts` (D1 + KV + `cachedStorage`).
- The provider table and client-construction helpers in `src/providers.ts` — swap in only the providers your app actually supports.
- The rule the routes follow: browser responses are metadata-only; `keys.getById` and provider construction happen inside the handler.

## What NOT to copy

- `DEMO_USER_ID` — derive the user id from your session layer (e.g. better-auth), never from browser input.
- Placeholder ids in `wrangler.jsonc` — create real D1/KV resources and set `wrangler secret put BYOK_MASTER_KEY` before deploying.
```

- [ ] **Step 2: Full verification**

Run: `npm run typecheck -w examples/cloudflare-worker && npm run test -w examples/cloudflare-worker`
Expected: both PASS.

- [ ] **Step 3: Commit**

```bash
git add examples/cloudflare-worker/README.md
git commit -m "docs(examples): document multi-provider setup for the cloudflare worker example"
```
