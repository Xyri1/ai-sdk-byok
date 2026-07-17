# @ai-sdk-byok/cloudflare

Cloudflare D1 storage adapter and Workers KV credential cache for [`ai-sdk-byok`](https://github.com/Xyri1/ai-sdk-byok). Credentials are always sealed with AES-256-GCM before touching D1 or KV; the master key lives in a Worker secret or Secrets Store binding.

## Setup

1. Generate a 32-byte master key and store it as a Worker secret:

   ```sh
   openssl rand -base64 32 | wrangler secret put BYOK_MASTER_KEY
   ```

2. Create a D1 database and KV namespace, bind them in `wrangler.jsonc` (for example as `DB` and `BYOK_CACHE`), and apply the shipped migration:

   ```sh
   wrangler d1 migrations apply <DATABASE_NAME> --remote
   ```

   The migration file is `node_modules/@ai-sdk-byok/cloudflare/migrations/0001_ai_sdk_byok_init.sql`; copy it into your project's `migrations/` directory.

## Usage (inside a Worker)

```ts
import { createByokManager, cachedStorage } from 'ai-sdk-byok';
import { d1Adapter, kvCredentialCache } from '@ai-sdk-byok/cloudflare';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const manager = createByokManager({
      storage: cachedStorage({
        storage: d1Adapter({ database: env.DB, encryptionKey: env.BYOK_MASTER_KEY }),
        cache: kvCredentialCache({ namespace: env.BYOK_CACHE, encryptionKey: env.BYOK_MASTER_KEY }),
        ttlMs: 60_000,
      }),
    });

    // save / list / get / getById / delete — see the ai-sdk-byok README.
    // Retrieve plaintext credentials as late as possible, server-side only.
    return new Response('ok');
  },
};
```

Using Secrets Store instead of a Worker secret? Pass a getter: `encryptionKey: () => env.BYOK_KEY_STORE.get()`.

## Security model

- D1 rows and KV values hold only AES-256-GCM ciphertext; a dump of both without the master key exposes nothing.
- Ciphertext is AAD-bound to its slot (`userId`/`provider`/`label` in D1, `userId`/`keyId` in KV) — sealed blobs copied between rows fail decryption.
- Losing the master key means stored credentials are unrecoverable; users re-enter their API keys.
- KV is eventually consistent: a rotated or deleted key may be served from another region until propagation (~60 s) plus remaining TTL. Keep `ttlMs` short.
- See `docs/threat-model.md` in the repository for the full model.

## Capacity

D1 caps a database at 10 GB — roughly 8M stored keys at typical API-key sizes. The schema is shard-friendly (all queries are keyed by `user_id`); shard across multiple D1 databases above that scale.
