# ai-sdk-byok

English | [中文](README.zh-CN.md)

Bring-your-own-key credential storage helpers for AI SDK applications.

`ai-sdk-byok` helps applications accept user-owned provider API keys without building credential lifecycle plumbing from scratch. It stores per-user API-key credentials, retrieves them only when server-side provider construction needs them, and keeps list responses free of plaintext secrets.

The v0.2 scope remains focused: single-field `{ apiKey }` credentials, Supabase Vault, Cloudflare, and Drizzle SQL adapters, with ESM entrypoints.

## Features

- Metadata-only `save`, `list`, and `delete` flows for user API keys.
- Explicit `get` and `getById` flows for retrieving plaintext credentials as late as possible.
- Credential objects that block `JSON.stringify` and object-level string coercion.
- Opaque provider names so applications can define their own provider IDs.
- Supabase Vault storage adapter with service-role-only RPC functions.
- Drizzle PostgreSQL storage adapter with application-side AES-256-GCM encryption.
- Optional adapter-agnostic `cachedStorage` wrapper for app-owned credential caches.
- ESM packages for `ai-sdk-byok`, `@ai-sdk-byok/supabase`, `@ai-sdk-byok/cloudflare`, and `@ai-sdk-byok/drizzle`.

## Packages

| Package | Purpose |
| --- | --- |
| `ai-sdk-byok` | Core manager, validation, metadata, and credential safety. |
| `@ai-sdk-byok/supabase` | Supabase Vault storage adapter. |
| `@ai-sdk-byok/cloudflare` | Cloudflare D1 storage adapter and Workers KV credential cache. |
| `@ai-sdk-byok/drizzle` | Drizzle PostgreSQL storage adapter with application-side encryption. |

## Install

```sh
# Supabase
npm install ai-sdk-byok @ai-sdk-byok/supabase @supabase/supabase-js

# Cloudflare Workers (D1 + KV)
npm install ai-sdk-byok @ai-sdk-byok/cloudflare

# Drizzle + PostgreSQL
npm install ai-sdk-byok @ai-sdk-byok/drizzle drizzle-orm
```

`@supabase/supabase-js` is an optional peer dependency. Install it when using the Supabase adapter.
`drizzle-orm` is a peer dependency of `@ai-sdk-byok/drizzle`. Install it when using the Drizzle adapter.

## Quickstart

Shown with the Supabase adapter — only the `storage` line changes per adapter. Full walkthroughs, including migrations and secrets, live in the per-adapter guides: [Supabase](docs/guides/supabase.md), [Cloudflare](docs/guides/cloudflare.md), [Drizzle](docs/guides/drizzle.md).

Apply the SQL migrations in [`packages/supabase/migrations`](packages/supabase/migrations) in order to a Supabase project with Vault enabled, then create a manager in trusted server-side code:

```ts
import { createByokManager } from 'ai-sdk-byok';
import { supabaseAdapter } from '@ai-sdk-byok/supabase';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
);

export const byok = createByokManager({
  storage: supabaseAdapter({ client: supabaseAdmin }),
});
```

Save or rotate a user's key:

```ts
await byok.keys.save({
  userId: 'user_123',
  provider: 'openai',
  credentials: { apiKey: process.env.USER_OPENAI_KEY! },
});
```

Retrieve the key only when constructing a provider. If the browser selected a key from `keys.list()`, pass only the metadata `id` to trusted server code and derive `userId` from auth/session state:

```ts
const record = await byok.keys.getById({
  userId: 'user_123',
  keyId: selectedKeyId,
});

if (!record) {
  throw new Error('Selected key was not found');
}

// Use record.provider for provider selection, not a browser-provided provider.
// Pass record.credentials.apiKey to your AI SDK provider factory here.
```

Omitting `label` stores and retrieves the credential under `default`.

Apps that address credentials by provider and label can continue to use `keys.get({ userId, provider, label })`.

### Optional credential cache

`cachedStorage` can wrap any storage adapter that supports key-id retrieval. It is disabled unless the app wires a cache backend:

```ts
import { cachedStorage, createByokManager } from 'ai-sdk-byok';

const byok = createByokManager({
  storage: cachedStorage({
    storage: supabaseAdapter({ client: supabaseAdmin }),
    cache: appCredentialCache,
    ttlMs: 60_000,
  }),
});
```

Cache entries contain plaintext credential records and must be server-only trusted secret infrastructure. Derive cache keys from trusted server-side `userId` plus `keyId`; never from browser-provided user ids. Read-path cache failures fall back to durable storage, while save/delete invalidation failures are reported as operation errors. Use short TTLs such as 30–120 seconds. Metadata/list caching is out of scope.

## Implement with an Agent

Copy this into your coding agent:

```text
Integrate `ai-sdk-byok` into this project by following https://github.com/Xyri1/ai-sdk-byok/blob/master/docs/agent-implementation.md
```

## API

The manager exposes:

| Method | Description |
| --- | --- |
| `keys.save(input)` | Stores or rotates one `{ apiKey }` credential for `(userId, provider, label)`. Returns metadata only. |
| `keys.list(input)` | Lists metadata for a user, ordered by latest update first. Never returns plaintext credentials. |
| `keys.get(input)` | Returns proxy-wrapped `{ apiKey }` credentials, or `null` when no key exists. |
| `keys.getById(input)` | Returns metadata plus proxy-wrapped `{ apiKey }` credentials for `{ userId, keyId }`, or `null`. |
| `keys.delete(input)` | Deletes a key by `userId` and `keyId`. Public API deletion is idempotent. |

Adapter factories: `supabaseAdapter({ client })`, `d1Adapter({ database, encryptionKey })` + `kvCredentialCache({ namespace, encryptionKey })`, and `drizzleAdapter({ db, dialect, encryption })`. Every export, option table, validation rule, and error type is documented in the [API reference](docs/reference/api.md).

## Security notes

- Store only single-field credentials shaped exactly as `{ apiKey: string }`.
- Do not log, serialize, or return credentials from request handlers.
- Use `keys.getById` or `keys.get` as late as possible and let returned credentials fall out of scope after provider construction.
- Metadata includes a short `keyHint`, but never exposes the underlying Vault secret ID.
- Supabase credential RPC functions are intended for service-role access only.
- The Drizzle master key is never stored in SQL; losing it makes stored credentials unrecoverable.
- Treat Redis or any other plaintext credential cache as trusted secret infrastructure with a TTL-bounded stale-credential window.

## Runtime support

- Node.js 22 or newer.
- ESM imports only.
- Core and adapter package entrypoints are ESM; the Drizzle adapter requires Node.js 22+ and a runtime-compatible PostgreSQL driver.

## Documentation

- [Getting started](docs/getting-started.md) — mental model and the minimal end-to-end flow.
- Integration guides: [Supabase Vault](docs/guides/supabase.md) · [Cloudflare D1 + KV](docs/guides/cloudflare.md) · [Drizzle Postgres](docs/guides/drizzle.md) · [Credential caching](docs/guides/caching.md)
- [API reference](docs/reference/api.md) — every export, option, and error type.
- [Security guide](docs/security.md) — guarantees, rules, and non-protections.
- [Agent implementation guide](docs/agent-implementation.md) — for coding agents; [`llms.txt`](llms.txt) indexes all docs.
- Internals: [architecture](docs/development/architecture.md) · [threat model](docs/development/threat-model.md) · [integration testing](docs/development/integration-testing.md) · [release checklist](docs/development/release-checklist.md)

## Examples

- [Next.js + Supabase](examples/nextjs-supabase/README.md) — key management UI and AI SDK chat route using the Supabase adapter.
- [Cloudflare Worker](examples/cloudflare-worker/README.md) — Hono Worker with key management UI, streaming chat, and a workerd end-to-end test suite.
- [Drizzle + Postgres](examples/drizzle/README.md) — Node + Hono key management UI and streaming chat using the Drizzle adapter with any Postgres.

## Development

```sh
npm install
npm run check
```

The project follows spec-driven development. Start with [requirements](docs/specs/001-ai-sdk-byok/requirements.md), then work through the [task checklist](docs/specs/001-ai-sdk-byok/tasks.md).
