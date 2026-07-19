# Example: Next.js + Supabase

A minimal Next.js 16 demo of `ai-sdk-byok`. It lets you save provider API keys for a hard-coded demo user, list their metadata, delete them, and then use one of them to stream a chat response from the selected provider via the AI SDK.

## What the demo covers

- **Key management UI** — save, list, and delete per-provider API keys through Server Actions.
- **Chat demo** — pick a saved key id, browse available models from the provider stored with that key, type a prompt, and stream the response.
- **Optional credential cache wiring** — disabled by default, with an app-owned Redis REST example for `cachedStorage`.
- **Database error state** — the app renders a setup notice if the Supabase migration has not been applied yet, rather than crashing.

## Supported providers

OpenAI, Anthropic, DeepSeek, xAI, Groq, Mistral, Cohere, OpenRouter, and any OpenAI-compatible endpoint.

## Prerequisites

- Node.js 22 or newer.
- A Supabase project with Vault enabled (available on all plans).
- A server-side Supabase secret key for the project.
- At least one provider API key to test with.

## Setup

### 1. Apply the migrations

Apply the migrations from the adapter package to your Supabase project in filename order. The easiest way is through the Supabase dashboard SQL editor:

1. Open your Supabase project → SQL editor.
2. Paste the contents of each SQL file in [`packages/supabase/migrations`](../../packages/supabase/migrations), in order.
3. Run each migration.

Alternatively, apply them with `psql` using your project's connection string:

```sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f ../../packages/supabase/migrations/202605190001_ai_sdk_byok_init.sql \
  -f ../../packages/supabase/migrations/202605190002_ai_sdk_byok_save_returns_metadata.sql \
  -f ../../packages/supabase/migrations/202605190003_ai_sdk_byok_get_credentials_by_id.sql
```

### 2. Configure environment variables

```sh
cp .env.example .env
```

Fill in `.env`:

```sh
# Required: your Supabase project URL and server-side secret key.
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SECRET_KEY=sb_secret_...

# Optional: base URL for the OpenAI-compatible provider (e.g. Ollama, LM Studio).
OPENAI_COMPATIBLE_BASE_URL=

# Optional: server-side example logs. One of debug, info, warn, error, silent.
BYOK_EXAMPLE_LOG_LEVEL=info

# Optional: Upstash-compatible Redis REST credential cache.
# Disabled unless both URL and token are set.
BYOK_REDIS_REST_URL=
BYOK_REDIS_REST_TOKEN=
BYOK_CREDENTIAL_CACHE_TTL_SECONDS=60
```

The secret key must only ever be used in server-side code. Never expose it in a browser bundle.

The Redis variables are also server-only. When enabled, cache values include plaintext API keys; treat the Redis project, dashboards, logs, and tokens as trusted secret infrastructure. This example is app-owned wiring against the generic cache interface, not a first-party Redis adapter package.

Server logs are structured with the `[byok-example]` prefix and are written only from trusted server-side code. They include setup state, metadata ids, providers, labels, key hints, cache hits, provider model-fetch status, and prompt length, but never plaintext API keys, prompts, provider request headers, or provider response bodies.

### 3. Install dependencies

From the repository root:

```sh
npm install
```

### 4. Build the package

The example is part of the root npm workspace and depends on the local `ai-sdk-byok` and `@ai-sdk-byok/supabase` workspace packages. Make sure the packages are built before running the dev server:

```sh
# from the repository root
npm run build
```

### 5. Start the dev server

```sh
# from examples/nextjs-supabase
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Using the demo

### Save a key

1. Choose a provider from the dropdown.
2. Paste your API key.
3. Optionally set a label (defaults to `default`).
4. Click **Save key**.

The saved key appears in the list as metadata only — no plaintext key is shown.

### Chat

1. Choose a saved key from the dropdown in the Chat section.
2. The model list loads automatically from the provider's models endpoint.
3. Select a model.
4. Type a prompt and click **Send**.

The browser sends only the selected key metadata id, model, and prompt. The server route derives `userId` from [`lib/demo-user.ts`](lib/demo-user.ts), calls `keys.getById({ userId, keyId })`, and uses the returned metadata provider for provider selection. Browser-provided provider values are not trusted for routing plaintext credentials.

### Delete a key

Click **Delete** next to any saved key in the list. The row is removed and the associated Vault secret is cleaned up by a database trigger.

## Notes

- The demo hardcodes `userId = 'demo-user'` in [`lib/demo-user.ts`](lib/demo-user.ts). This is intentional for a local demo; a real application would use the authenticated user's ID.
- The OpenAI-compatible provider requires `OPENAI_COMPATIBLE_BASE_URL` to be set for both model listing and chat.
- Credential caching uses `ai-sdk-byok`'s generic `cachedStorage` wrapper around the Supabase adapter. It caches only key-id credential retrieval, not metadata/list responses.
- Cache keys are derived from trusted server-side `userId` plus `keyId` and hashed before sending to Redis. Save/rotation and delete invalidate cached credentials; TTL bounds stale-cache windows when infrastructure fails outside those operations.
- The dev server runs with `--webpack` because the example targets Next.js 16 and uses local workspace package dependencies.
