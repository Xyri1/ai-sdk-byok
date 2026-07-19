# @ai-sdk-byok/drizzle

Drizzle-backed PostgreSQL storage adapter for [`ai-sdk-byok`](https://github.com/Xyri1/ai-sdk-byok). Credentials are encrypted in trusted application code before they reach SQL.

## Install

```sh
npm install ai-sdk-byok @ai-sdk-byok/drizzle drizzle-orm
```

`drizzle-orm` is a peer dependency. Install and configure a PostgreSQL-compatible Drizzle driver in the application; this package does not create connections or own pooling.

## Requirements

- Node.js 22 or newer.
- A PostgreSQL database.
- A caller-owned Drizzle database instance.
- Trusted server-side code for the master key and credential retrieval.

The initial supported dialect is `postgres`. SQLite is not supported by this adapter yet.

## Migration setup

Apply [`migrations/0001_ai_sdk_byok_init.sql`](migrations/0001_ai_sdk_byok_init.sql) to the application database. When installed from npm, the file is available at `node_modules/@ai-sdk-byok/drizzle/migrations/0001_ai_sdk_byok_init.sql` and can be copied into the application's migrations directory.

Applications using Drizzle Kit can instead generate a migration from the exported `aiSdkByokKeys` schema. Use either the shipped SQL migration or the generated equivalent, not both.

## Usage

`db` is the application's configured Drizzle PostgreSQL database:

```ts
import { createByokManager } from 'ai-sdk-byok';
import { drizzleAdapter } from '@ai-sdk-byok/drizzle';

export const byok = createByokManager({
  storage: drizzleAdapter({
    db,
    dialect: 'postgres',
    encryption: {
      current: {
        version: 'v1',
        key: process.env.AI_SDK_BYOK_MASTER_KEY!,
      },
    },
  }),
});
```

Generate a string master key with `openssl rand -base64 32` and keep it in a server-side secret. The adapter accepts the configured `current` key for new writes and optional `previous` keys for reading older rows.

## Key rotation

Set the new key as `current` and keep the old key in `previous`. New writes and credential rotations use `current`; `previous` keys are read-only and decrypt rows carrying their matching version. Re-encryption of existing rows may be deferred, so keep each previous key configured while those rows remain.

## Security

- The master key is never stored in SQL.
- Losing the master key makes stored credentials unrecoverable.
- If a master key leaks, rows encrypted under that key must be treated as compromised when their ciphertext may also have been exposed. Affected users should rotate their provider API keys.
- This adapter protects against database-only compromise, including leaked backups, dumps, and read replicas. It does not protect against application-server compromise.
- Cryptography is pinned to AES-256-GCM with a 32-byte base64 master key, a new random 12-byte nonce for each write, and additional authenticated data bound to `(userId, provider)`.

SQL stores metadata plus base64url ciphertext, nonce, and the non-secret encryption-key version. Plaintext credentials and key material remain in trusted application memory.
