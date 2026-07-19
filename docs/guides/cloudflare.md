# Integration Guide: Cloudflare Workers (D1 + KV)

Store user API keys in Cloudflare D1, optionally cached in Workers KV. Credentials are sealed with AES-256-GCM in the Worker before they touch either store; the master key lives in a Worker secret or Secrets Store binding.

New to the library? Read [Getting Started](../getting-started.md) first for the mental model.

## 1. Prerequisites

Confirm every item before starting:

- [ ] A Cloudflare Workers project using Wrangler (this guide assumes `wrangler.jsonc`).
- [ ] Ability to create a D1 database and (optionally) a KV namespace.
- [ ] TypeScript recommended; ESM.
- [ ] All provider construction happens inside the Worker — this library has no browser-side role.
- [ ] User credentials representable as a single `{ apiKey: string }` field.

The KV cache is optional. D1 alone is a complete integration; add KV when you want lower-latency repeated `getById` reads.

## 2. Install

```sh
npm install ai-sdk-byok @ai-sdk-byok/cloudflare
```

## 3. Create resources and apply the migration

Create the D1 database (and KV namespace if caching):

```sh
wrangler d1 create byok-keys
wrangler kv namespace create BYOK_CACHE   # optional
```

Bind them in `wrangler.jsonc` (using the ids from the commands above):

```jsonc
{
  "d1_databases": [
    { "binding": "DB", "database_name": "byok-keys", "database_id": "<id>" }
  ],
  "kv_namespaces": [
    { "binding": "BYOK_CACHE", "id": "<id>" }
  ]
}
```

Copy the shipped migration into your project's `migrations/` directory and apply it:

```sh
cp node_modules/@ai-sdk-byok/cloudflare/migrations/0001_ai_sdk_byok_init.sql migrations/
wrangler d1 migrations apply byok-keys --local     # local dev database
wrangler d1 migrations apply byok-keys --remote    # production
```

The migration creates the `ai_sdk_byok_keys` table: metadata columns plus a single `credentials_ciphertext` column. No plaintext ever reaches D1.

**Verify:**

```sh
wrangler d1 execute byok-keys --remote --command "SELECT name FROM sqlite_master WHERE name='ai_sdk_byok_keys';"
```

## 4. Configure the master key

Generate a 32-byte key and store it as a Worker secret:

```sh
openssl rand -base64 32 | wrangler secret put BYOK_MASTER_KEY
```

For local dev, put it in `.dev.vars` (gitignored):

```sh
BYOK_MASTER_KEY=<openssl rand -base64 32 output>
```

Rules:

- The key must decode to exactly 32 bytes; the adapter validates this at startup.
- It lives only in Worker secrets or a Secrets Store binding — never in `wrangler.jsonc` vars, code, or logs.
- **Losing it makes all stored credentials unrecoverable** (users would re-enter their keys). Keep a copy in your team's secret manager.
- Using Secrets Store instead of a plain secret? Pass a getter: `encryptionKey: () => env.BYOK_KEY_STORE.get()`.

## 5. Create the manager

Construct the manager per-request from the environment bindings:

```ts
import { createByokManager, cachedStorage, type ByokManager } from 'ai-sdk-byok';
import { d1Adapter, kvCredentialCache } from '@ai-sdk-byok/cloudflare';

interface Env {
  DB: D1Database;
  BYOK_CACHE: KVNamespace;
  BYOK_MASTER_KEY: string;
}

function createManager(env: Env): ByokManager {
  return createByokManager({
    storage: cachedStorage({
      storage: d1Adapter({ database: env.DB, encryptionKey: env.BYOK_MASTER_KEY }),
      cache: kvCredentialCache({ namespace: env.BYOK_CACHE, encryptionKey: env.BYOK_MASTER_KEY }),
      ttlMs: 60_000,
    }),
  });
}
```

Without the KV cache, `storage` is just `d1Adapter({ database: env.DB, encryptionKey: env.BYOK_MASTER_KEY })`.

## 6. Wire the four flows

All handlers derive `userId` from your auth/session layer — never from a browser-supplied value. Shown with Hono; plain `fetch` handlers work identically.

```ts
import { Hono } from 'hono';
import { streamText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';

const app = new Hono<{ Bindings: Env }>();

// Save (and rotate)
app.post('/api/keys', async (c) => {
  const userId = await getSessionUserId(c);         // trusted
  const { provider, label, apiKey } = await c.req.json();

  const metadata = await createManager(c.env).keys.save({
    userId,
    provider,
    label,                                          // optional; defaults to 'default'
    credentials: { apiKey },
  });

  return c.json(metadata);                          // metadata only — safe
});

// List
app.get('/api/keys', async (c) => {
  const userId = await getSessionUserId(c);
  return c.json(await createManager(c.env).keys.list({ userId }));
});

// Delete
app.delete('/api/keys/:keyId', async (c) => {
  const userId = await getSessionUserId(c);
  await createManager(c.env).keys.delete({ userId, keyId: c.req.param('keyId') });
  return c.json({ ok: true });
});

// Use a key — retrieve credentials as late as possible
app.post('/api/chat', async (c) => {
  const userId = await getSessionUserId(c);
  const { keyId, messages } = await c.req.json();   // keyId came from keys.list metadata

  const record = await createManager(c.env).keys.getById({ userId, keyId });

  if (!record) {
    return c.text('Selected key was not found', 404);
  }

  // Select the provider from stored metadata, not from browser input.
  if (record.provider !== 'openai') {
    return c.text('Choose an OpenAI key', 400);
  }

  const openai = createOpenAI({ apiKey: record.credentials.apiKey });
  const result = streamText({ model: openai('gpt-5'), messages });

  return result.toTextStreamResponse();
});

export default app;
```

Do not log `record`, put it in error reports, or return it from a handler. `JSON.stringify(record.credentials)` throws by design.

## 7. Verify

Run locally — `wrangler dev` uses the local D1/KV and `.dev.vars`:

```sh
wrangler dev
```

Then, against the local server:

```sh
curl -X POST localhost:8787/api/keys -H 'content-type: application/json' \
  -d '{"provider":"openai","apiKey":"sk-test-1234"}'
# expect: metadata JSON with "keyHint":"1234" and no credential fields

curl localhost:8787/api/keys
# expect: one metadata entry

wrangler d1 execute byok-keys --local \
  --command "SELECT credentials_ciphertext FROM ai_sdk_byok_keys LIMIT 1;"
# expect: an opaque v1.… sealed blob, not your key
```

Finally exercise the chat route with a real provider key and confirm a streamed response. For an end-to-end reference including a workerd test suite, see [examples/cloudflare-worker](../../examples/cloudflare-worker/README.md).

## 8. Operational notes

- **AAD binding:** ciphertext is bound to its slot (`userId`/`provider`/`label` in D1, `userId`/`keyId` in KV). Sealed blobs copied between rows fail decryption — a dump of D1 and KV without the master key exposes nothing usable.
- **KV is eventually consistent.** After rotation or deletion, another region may serve the old cached credential until propagation (~60 s) plus remaining TTL. Keep `ttlMs` short (30–120 s). KV's physical `expirationTtl` has a 60-second floor; the cache also embeds a sealed logical expiry that is authoritative.
- **Cache invalidation is best-effort.** If KV is briefly unavailable, `save` and `delete` still succeed against D1; stale entries die at TTL.
- **Key rotation (master key):** the sealed format is versioned (`v1.`), but multi-key rotation is not yet built in. Rotating today means re-saving credentials under the new key (users re-enter keys, or you decrypt-and-reseal while both keys are available in a migration script you control).
- **Capacity:** D1 caps a database at 10 GB — roughly 8M stored keys. All queries are keyed by `user_id`, so the schema shards cleanly across multiple D1 databases beyond that.

Further reading: [security guide](../security.md) · [API reference](../reference/api.md) · [caching guide](caching.md) · [threat model](../development/threat-model.md)
