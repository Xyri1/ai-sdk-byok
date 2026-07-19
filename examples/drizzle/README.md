# Drizzle + Postgres example

A minimal Node app showing `@ai-sdk-byok/drizzle`: a key management UI plus streaming
chat, with application-side AES-256-GCM encryption against any PostgreSQL database. No
Supabase Vault, no Cloudflare bindings, no frontend framework — Hono, one static HTML
page, and a `DATABASE_URL`.

## Prerequisites

- Node.js 22+
- Any reachable Postgres. One easy option:

  ```sh
  docker run --name byok-postgres -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres:17
  ```

## Setup

This example is intentionally **not** part of the repo's npm workspace: it installs
`ai-sdk-byok` and `@ai-sdk-byok/drizzle` from the npm registry, exactly as your own
app would.

```sh
cd examples/drizzle
npm install
cp .env.example .env   # set DATABASE_URL; generate the master key:
                       #   openssl rand -base64 32  -> AI_SDK_BYOK_MASTER_KEY
npm run migrate
npm run dev            # http://localhost:3000
```

The migration script resolves the shipped SQL through the installed package, so it
works the same in your own app after `npm install ai-sdk-byok @ai-sdk-byok/drizzle`.

## Migrations

`npm run migrate` is idempotent. It applies, in order:

1. The SQL shipped inside `@ai-sdk-byok/drizzle` (`migrations/0001_ai_sdk_byok_init.sql`),
   creating `ai_sdk_byok_keys`.
2. The example's own `custom_provider_endpoint` table.

Already-applied steps report `already applied` and are skipped. Apps that use Drizzle
Kit can instead generate the BYOK table from the exported `aiSdkByokKeys` schema; this
example uses the shipped SQL for clarity.

## OpenAI-compatible base URLs

BYOK credentials stay `{ apiKey }` only. For the `openai-compatible` provider, the save
form asks for a base URL, which the server stores in `custom_provider_endpoint`
(`key_id` → `base_url`). Models and chat look the base URL up by key id server-side —
a browser-supplied base URL is never used for provider routing.

## Environment

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string (required) |
| `AI_SDK_BYOK_MASTER_KEY` | Base64, 32 bytes; encrypts credentials app-side (required) |
| `BYOK_EXAMPLE_LOG_LEVEL` | `debug` \| `info` \| `warn` \| `error` (default `info`) |
| `BYOK_REDIS_REST_URL` / `BYOK_REDIS_REST_TOKEN` | Optional Redis REST credential cache |
| `BYOK_CREDENTIAL_CACHE_TTL_SECONDS` | Cache TTL when the cache is enabled (default 60) |

## Security notes

- The master key and Redis token are server-only; plaintext keys, ciphertext, and
  nonces are never logged or returned to the browser — list/save responses are
  metadata only.
- The demo hard-codes `demo-user`. Real apps must derive the user id from their
  session/auth layer, never from browser input.

## Tests

```sh
npm test -w examples/drizzle                     # handler tests on an in-memory fake
DATABASE_URL=... npm test -w examples/drizzle    # + migrate/CRUD against real Postgres
```
