# ai-sdk-byok

English | [中文](README.zh-CN.md)

Bring-your-own-key credential storage helpers for AI SDK applications.

`ai-sdk-byok` helps applications accept user-owned provider API keys without building credential lifecycle plumbing from scratch. It stores per-user API-key credentials, retrieves them only when server-side provider construction needs them, and keeps list responses free of plaintext secrets.

The v0.1 scope is intentionally small: single-field `{ apiKey }` credentials, an adapter for Supabase Vault, and Edge-compatible ESM entrypoints.

## Features

- Metadata-only `save`, `list`, and `delete` flows for user API keys.
- Explicit `get` and `getById` flows for retrieving plaintext credentials as late as possible.
- Credential objects that block `JSON.stringify` and object-level string coercion.
- Opaque provider names so applications can define their own provider IDs.
- Supabase Vault storage adapter with service-role-only RPC functions.
- Optional adapter-agnostic `cachedStorage` wrapper for app-owned credential caches.
- Edge-compatible packages for `ai-sdk-byok` and `@ai-sdk-byok/supabase`.

## Install

```sh
npm install ai-sdk-byok @ai-sdk-byok/supabase @supabase/supabase-js
```

`@supabase/supabase-js` is an optional peer dependency. Install it when using the Supabase adapter.

## Quickstart

Apply the SQL migrations in [`supabase/migrations`](supabase/migrations) in order to a Supabase project with Vault enabled, then create a manager in trusted server-side code:

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

### `createByokManager(options)`

Creates a BYOK manager from a storage adapter.

```ts
const byok = createByokManager({ storage });
```

The manager exposes:

| Method | Description |
| --- | --- |
| `keys.save(input)` | Stores or rotates one `{ apiKey }` credential for `(userId, provider, label)`. Returns metadata only. |
| `keys.list(input)` | Lists metadata for a user, ordered by latest update first. Never returns plaintext credentials. |
| `keys.get(input)` | Returns proxy-wrapped `{ apiKey }` credentials, or `null` when no key exists. |
| `keys.getById(input)` | Returns metadata plus proxy-wrapped `{ apiKey }` credentials for `{ userId, keyId }`, or `null`. |
| `keys.delete(input)` | Deletes a key by `userId` and `keyId`. Public API deletion is idempotent. |

### `supabaseAdapter(options)`

Creates a storage adapter backed by Supabase Vault and the package migration's RPC functions.

```ts
const storage = supabaseAdapter({ client: supabaseAdmin });
```

The Supabase client must be created with a server-side secret key and must never be exposed to browser code.

### Cloudflare (D1 + KV)

For apps on Cloudflare Workers, `@ai-sdk-byok/cloudflare` provides a D1 storage adapter and a Workers KV credential cache. Credentials are always sealed with AES-256-GCM before reaching storage; the master key lives in a Worker secret. See `packages/cloudflare/README.md` for setup.

A runnable example lives in [`examples/cloudflare-worker`](examples/cloudflare-worker) — key management UI plus server-side provider construction, with an end-to-end test suite running in workerd.

## Security notes

- Store only single-field credentials shaped exactly as `{ apiKey: string }`.
- Do not log, serialize, or return credentials from request handlers.
- Use `keys.getById` or `keys.get` as late as possible and let returned credentials fall out of scope after provider construction.
- Metadata includes a short `keyHint`, but never exposes the underlying Vault secret ID.
- Supabase credential RPC functions are intended for service-role access only.
- Treat Redis or any other plaintext credential cache as trusted secret infrastructure with a TTL-bounded stale-credential window.

## Runtime support

- Node.js 22 or newer.
- ESM imports only.
- Core and Supabase package entrypoints are designed to remain Edge-compatible.

## Documentation

- [Quickstart](docs/quickstart.md)
- [Agent implementation guide](docs/agent-implementation.md)
- [Architecture](docs/architecture.md)
- [Threat model](docs/threat-model.md)
- [Integration testing](docs/integration-testing.md)
- [Release checklist](docs/release-checklist.md)

## Examples

- [Next.js + Supabase](examples/nextjs-supabase/README.md) — key management UI and AI SDK chat route using the Supabase adapter.

## Development

```sh
npm install
npm run check
```

The project follows spec-driven development. Start with [requirements](docs/specs/001-ai-sdk-byok/requirements.md), then work through the [task checklist](docs/specs/001-ai-sdk-byok/tasks.md).
