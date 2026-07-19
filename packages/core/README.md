# ai-sdk-byok

Bring-your-own-key credential storage for AI SDK applications. Store per-user provider API keys, list metadata safely, and retrieve plaintext credentials only at the moment of server-side provider construction.

This is the core package: the manager, input validation, credential-safety proxy, and the optional `cachedStorage` wrapper. Storage comes from an adapter package:

| Adapter | For apps on |
| --- | --- |
| [`@ai-sdk-byok/supabase`](https://www.npmjs.com/package/@ai-sdk-byok/supabase) | Supabase (Vault) |
| [`@ai-sdk-byok/cloudflare`](https://www.npmjs.com/package/@ai-sdk-byok/cloudflare) | Cloudflare Workers (D1 + KV) |
| [`@ai-sdk-byok/drizzle`](https://www.npmjs.com/package/@ai-sdk-byok/drizzle) | PostgreSQL with Drizzle ORM |

## Install

```sh
npm install ai-sdk-byok @ai-sdk-byok/supabase    # or /cloudflare, /drizzle
```

## Usage

```ts
import { createByokManager } from 'ai-sdk-byok';

// Server-only. `storage` comes from an adapter package.
export const byok = createByokManager({ storage });

// Save or rotate a user's key — returns metadata only.
await byok.keys.save({ userId, provider: 'openai', credentials: { apiKey } });

// List metadata — safe for browser-visible responses.
const keys = await byok.keys.list({ userId });

// Retrieve the credential as late as possible, inside the route that needs it.
const record = await byok.keys.getById({ userId, keyId: selectedKeyId });
// record.provider           → select the AI SDK provider from stored metadata
// record.credentials.apiKey → pass to the provider factory, then let it fall out of scope

await byok.keys.delete({ userId, keyId });   // idempotent
```

`userId` must come from your server-side auth/session — never from the browser. Returned credentials are proxy-wrapped: `JSON.stringify` and string coercion throw instead of leaking the key.

| Method | Returns |
| --- | --- |
| `keys.save(input)` | Metadata only; rotates in place on same `(userId, provider, label)` |
| `keys.list(input)` | Metadata array, newest first — never credentials |
| `keys.get(input)` | Proxy-wrapped `{ apiKey }` by `(userId, provider, label)`, or `null` |
| `keys.getById(input)` | Metadata + proxy-wrapped credentials by `(userId, keyId)`, or `null` |
| `keys.delete(input)` | Nothing; idempotent |

`cachedStorage` optionally wraps any adapter with a server-only read-path credential cache for `getById` (first-party backend on Cloudflare KV; bring your own elsewhere).

## Documentation

- [Getting started](https://github.com/Xyri1/ai-sdk-byok/blob/master/docs/getting-started.md) — mental model and minimal flow
- Integration guides: [Supabase](https://github.com/Xyri1/ai-sdk-byok/blob/master/docs/guides/supabase.md) · [Cloudflare](https://github.com/Xyri1/ai-sdk-byok/blob/master/docs/guides/cloudflare.md) · [Drizzle](https://github.com/Xyri1/ai-sdk-byok/blob/master/docs/guides/drizzle.md) · [Caching](https://github.com/Xyri1/ai-sdk-byok/blob/master/docs/guides/caching.md)
- [API reference](https://github.com/Xyri1/ai-sdk-byok/blob/master/docs/reference/api.md)
- [Security guide](https://github.com/Xyri1/ai-sdk-byok/blob/master/docs/security.md)

Requires Node.js 22+ (or Cloudflare Workers); ESM only.
