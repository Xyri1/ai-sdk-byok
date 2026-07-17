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
