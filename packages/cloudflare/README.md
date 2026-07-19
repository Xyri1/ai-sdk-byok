# @ai-sdk-byok/cloudflare

Cloudflare D1 storage adapter and Workers KV credential cache for [`ai-sdk-byok`](https://www.npmjs.com/package/ai-sdk-byok). Credentials are always sealed with AES-256-GCM before touching D1 or KV; the master key lives in a Worker secret or Secrets Store binding.

## Install

```sh
npm install ai-sdk-byok @ai-sdk-byok/cloudflare
```

## Setup

1. Generate a 32-byte master key and store it as a Worker secret:

   ```sh
   openssl rand -base64 32 | wrangler secret put BYOK_MASTER_KEY
   ```

2. Create a D1 database (and optionally a KV namespace for caching), bind them in `wrangler.jsonc` (for example as `DB` and `BYOK_CACHE`), copy `node_modules/@ai-sdk-byok/cloudflare/migrations/0001_ai_sdk_byok_init.sql` into your project's `migrations/` directory, and apply it:

   ```sh
   wrangler d1 migrations apply <DATABASE_NAME> --remote
   ```

## Usage (inside a Worker)

```ts
import { createByokManager, cachedStorage } from 'ai-sdk-byok';
import { d1Adapter, kvCredentialCache } from '@ai-sdk-byok/cloudflare';

function createManager(env: Env) {
  return createByokManager({
    storage: cachedStorage({
      storage: d1Adapter({ database: env.DB, encryptionKey: env.BYOK_MASTER_KEY }),
      cache: kvCredentialCache({ namespace: env.BYOK_CACHE, encryptionKey: env.BYOK_MASTER_KEY }),
      ttlMs: 60_000,
    }),
  });
}
```

D1 alone is a complete integration — drop `cachedStorage` and pass `d1Adapter(...)` directly if you skip KV. Then use `keys.save / list / get / getById / delete`; retrieve plaintext credentials as late as possible, server-side only.

Using Secrets Store instead of a Worker secret? Pass a getter: `encryptionKey: () => env.BYOK_KEY_STORE.get()`.

## Security model

- D1 rows and KV values hold only AES-256-GCM ciphertext; a dump of both without the master key exposes nothing.
- Ciphertext is AAD-bound to its slot (`userId`/`provider`/`label` in D1, `userId`/`keyId` in KV) — sealed blobs copied between rows fail decryption.
- Losing the master key means stored credentials are unrecoverable; users re-enter their API keys.
- KV is eventually consistent: a rotated or deleted key may be served from another region until propagation (~60 s) plus remaining TTL. Keep `ttlMs` short.
- Cache invalidation is best-effort: if KV is unavailable, `save` and `delete` still succeed against D1, and any stale cache entry expires by its TTL.

## Capacity

D1 caps a database at 10 GB — roughly 8M stored keys at typical API-key sizes. The schema is shard-friendly (all queries are keyed by `user_id`); shard across multiple D1 databases above that scale.

## Documentation

- [Cloudflare integration guide](https://github.com/Xyri1/ai-sdk-byok/blob/master/docs/guides/cloudflare.md) — full walkthrough: resources, migration, secrets, Hono route wiring, verification
- [API reference](https://github.com/Xyri1/ai-sdk-byok/blob/master/docs/reference/api.md)
- [Security guide](https://github.com/Xyri1/ai-sdk-byok/blob/master/docs/security.md)
- [Cloudflare Worker example](https://github.com/Xyri1/ai-sdk-byok/tree/master/examples/cloudflare-worker) — runnable, with a workerd end-to-end test suite
