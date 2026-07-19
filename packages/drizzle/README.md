# @ai-sdk-byok/drizzle

Drizzle-backed PostgreSQL storage adapter for [`ai-sdk-byok`](https://www.npmjs.com/package/ai-sdk-byok). Credentials are encrypted with AES-256-GCM in trusted application code before they reach SQL; the database only sees metadata, ciphertext, a nonce, and a key-version string.

## Install

```sh
npm install ai-sdk-byok @ai-sdk-byok/drizzle drizzle-orm
```

`drizzle-orm` is a peer dependency. Bring your own PostgreSQL-compatible Drizzle driver; this package does not create connections or own pooling. Requires Node.js 22+; the supported dialect is `postgres` (no SQLite).

## Setup

1. Apply the migration shipped at `node_modules/@ai-sdk-byok/drizzle/migrations/0001_ai_sdk_byok_init.sql`, **or** let Drizzle Kit generate the equivalent from the exported `aiSdkByokKeys` schema — one or the other, not both.
2. Generate a 32-byte base64 master key (`openssl rand -base64 32`) and keep it in server-side secrets.
3. Create the manager with your app's Drizzle database:

```ts
import { createByokManager } from 'ai-sdk-byok';
import { drizzleAdapter } from '@ai-sdk-byok/drizzle';
import { db } from './db';

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

Then use `byok.keys.save / list / get / getById / delete` — see the guide below for wiring the flows into routes.

## Key rotation

Set a new key as `current` (new version) and keep the old key in `previous`:

```ts
encryption: {
  current: { version: 'v2', key: newKey },
  previous: [{ version: 'v1', key: oldKey }],
}
```

New writes use `current`; `previous` keys are read-only and decrypt rows carrying their version. Keep each previous key configured while rows under it remain.

## Security model

- The master key is never stored in SQL; losing it makes stored credentials unrecoverable.
- Protects against database-only compromise — leaked backups, dumps, read replicas — not against application-server compromise.
- If a master key leaks, treat rows encrypted under it as compromised where the ciphertext may also have been exposed; affected users should rotate their provider API keys.
- Cryptography is pinned: AES-256-GCM, 32-byte base64 master key, fresh random 12-byte nonce per write, AAD bound to `(userId, provider)`.

## Documentation

- [Drizzle integration guide](https://github.com/Xyri1/ai-sdk-byok/blob/master/docs/guides/drizzle.md) — full walkthrough: migration, master key, route wiring, verification, rotation
- [API reference](https://github.com/Xyri1/ai-sdk-byok/blob/master/docs/reference/api.md)
- [Security guide](https://github.com/Xyri1/ai-sdk-byok/blob/master/docs/security.md)
- [Drizzle + Postgres example](https://github.com/Xyri1/ai-sdk-byok/tree/master/examples/drizzle)
