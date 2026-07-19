# Integration Guide: Drizzle + PostgreSQL

Store user API keys in your own PostgreSQL database through Drizzle ORM. Credentials are encrypted with AES-256-GCM in trusted application code before they reach SQL; the database only ever sees metadata, ciphertext, a nonce, and a key-version string.

New to the library? Read [Getting Started](../getting-started.md) first for the mental model.

## 1. Prerequisites

Confirm every item before starting:

- [ ] Node.js 22 or newer, ESM, TypeScript recommended.
- [ ] A PostgreSQL database (any host: RDS, Neon, local Docker, …).
- [ ] A caller-owned Drizzle database instance — this package does not create connections or own pooling.
- [ ] Trusted server-side code where the master key and credentials can be used — this library has no browser-side role.
- [ ] User credentials representable as a single `{ apiKey: string }` field.

The supported dialect is `postgres`. SQLite is not supported by this adapter.

## 2. Install

```sh
npm install ai-sdk-byok @ai-sdk-byok/drizzle drizzle-orm
```

`drizzle-orm` is a peer dependency. Also install a Postgres driver for your environment (e.g. `pg` or `postgres`) if you don't have one.

## 3. Apply the migration

The adapter ships one SQL migration at `node_modules/@ai-sdk-byok/drizzle/migrations/0001_ai_sdk_byok_init.sql`. Apply it **one** of two ways:

**Shipped SQL** — with psql:

```sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f node_modules/@ai-sdk-byok/drizzle/migrations/0001_ai_sdk_byok_init.sql
```

or copy the file into your app's migrations directory and run it through your migration runner.

**Drizzle Kit** — import the exported schema and let `drizzle-kit generate` produce the equivalent migration:

```ts
// drizzle.config.ts schema entry, or re-export from your schema file
export { aiSdkByokKeys } from '@ai-sdk-byok/drizzle';
```

Use the shipped SQL **or** the generated migration, not both.

The migration creates `ai_sdk_byok_keys`: metadata columns plus `credentials_ciphertext`, `credentials_nonce`, and `encryption_key_version`, with a unique constraint on `(user_id, provider, label)`.

**Verify:**

```sh
psql "$DATABASE_URL" -c "\d ai_sdk_byok_keys"
```

## 4. Configure the master key

Generate a 32-byte base64 master key and store it in server-side secrets:

```sh
openssl rand -base64 32
```

```sh
# .env (server-only, gitignored)
DATABASE_URL=postgres://...
AI_SDK_BYOK_MASTER_KEY=<generated value>
```

Rules:

- The key must decode to exactly 32 bytes; the adapter validates this at startup.
- It is never stored in SQL and must never appear in logs, error messages, or browser-visible code.
- **Losing it makes all stored credentials unrecoverable** (users would re-enter their keys). Keep a copy in your team's secret manager.

## 5. Create the manager

One server-only module, using your app's existing Drizzle database:

```ts
// lib/byok.ts — server-only
import { createByokManager } from 'ai-sdk-byok';
import { drizzleAdapter } from '@ai-sdk-byok/drizzle';
import { db } from './db';   // your configured Drizzle Postgres instance

export const byok = createByokManager({
  storage: drizzleAdapter({
    db,
    dialect: 'postgres',
    encryption: {
      current: { version: 'v1', key: process.env.AI_SDK_BYOK_MASTER_KEY! },
    },
  }),
});
```

`encryption.current` encrypts all new writes; `encryption.previous` (see [key rotation](#8-operational-notes)) decrypts older rows.

## 6. Wire the four flows

All handlers derive `userId` from your auth/session state — never from a browser-supplied value. Shown with Hono; Express, Fastify, or Next.js route handlers work identically.

```ts
import { Hono } from 'hono';
import { streamText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { byok } from './lib/byok';

const app = new Hono();

// Save (and rotate)
app.post('/api/keys', async (c) => {
  const userId = await getSessionUserId(c);         // trusted
  const { provider, label, apiKey } = await c.req.json();

  const metadata = await byok.keys.save({
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
  return c.json(await byok.keys.list({ userId }));
});

// Delete
app.delete('/api/keys/:keyId', async (c) => {
  const userId = await getSessionUserId(c);
  await byok.keys.delete({ userId, keyId: c.req.param('keyId') });
  return c.json({ ok: true });
});

// Use a key — retrieve credentials as late as possible
app.post('/api/chat', async (c) => {
  const userId = await getSessionUserId(c);
  const { keyId, messages } = await c.req.json();   // keyId came from keys.list metadata

  const record = await byok.keys.getById({ userId, keyId });

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
```

Do not log `record`, put it in error reports, or return it from a handler. `JSON.stringify(record.credentials)` throws by design.

## 7. Verify

Smoke-test from a throwaway server-side script with a disposable credential:

```ts
const meta = await byok.keys.save({
  userId: 'smoke-test-user',
  provider: 'openai',
  credentials: { apiKey: 'sk-test-1234' },
});

const listed = await byok.keys.list({ userId: 'smoke-test-user' });
// expect: one entry, keyHint '1234', no credential fields anywhere

const record = await byok.keys.getById({ userId: 'smoke-test-user', keyId: meta.id });
// expect: record.credentials.apiKey === 'sk-test-1234'

await byok.keys.delete({ userId: 'smoke-test-user', keyId: meta.id });
// expect: keys.list returns []
```

Then confirm the database never saw plaintext:

```sh
psql "$DATABASE_URL" -c \
  "SELECT credentials_ciphertext, credentials_nonce, encryption_key_version FROM ai_sdk_byok_keys;"
# expect: base64url blobs and 'v1' — never an API key
```

## 8. Operational notes

- **Master-key rotation:** generate a new key, set it as `current` with a new version, and move the old key into `previous`:

  ```ts
  encryption: {
    current: { version: 'v2', key: process.env.AI_SDK_BYOK_MASTER_KEY_V2! },
    previous: [{ version: 'v1', key: process.env.AI_SDK_BYOK_MASTER_KEY! }],
  }
  ```

  New writes and rotations use `current`; `previous` keys are read-only and decrypt rows carrying their version. Rows re-encrypt naturally when a user rotates their key; keep each previous key configured while rows under it remain (check with `SELECT DISTINCT encryption_key_version FROM ai_sdk_byok_keys;`).

- **If a master key leaks:** treat rows encrypted under it as compromised wherever the ciphertext may also have been exposed. Have affected users rotate their provider API keys — re-encrypting with a new master key does not retroactively protect already-decryptable data.
- **What the encryption buys you:** protection against database-only compromise — leaked backups, dumps, read replicas. It does not protect against a compromised application server, which holds the key.
- **Crypto details (pinned):** AES-256-GCM, fresh random 12-byte nonce per write, AAD bound to `(userId, provider)` so ciphertext cannot be moved between slots.
- **Optional caching:** for lower-latency `getById`, wrap the adapter with `cachedStorage` and an app-owned server-only cache — see the [caching guide](caching.md).
- **Runnable example:** [examples/drizzle](../../examples/drizzle/README.md) — Hono key-management UI and streaming chat against any Postgres, with an idempotent migration script.

Further reading: [security guide](../security.md) · [API reference](../reference/api.md) · [threat model](../development/threat-model.md)
