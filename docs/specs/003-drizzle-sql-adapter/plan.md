# Implementation Plan

## Architecture

This scope adds a new adapter package below the existing core manager.

- The core manager continues to own validation, label normalization, key-hint derivation, metadata-only public responses, and credential proxy wrapping.
- The Drizzle adapter owns SQL persistence and application-side encryption.
- Drizzle is the database abstraction.
- Postgres is the first supported dialect.
- SQLite remains a future dialect using the same logical adapter behavior.

The adapter writes only metadata and encrypted payload fields to SQL. Plaintext credentials and master-key material stay in trusted application memory.

## API Shape

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

The adapter accepts a caller-owned Drizzle database instance. Applications remain responsible for driver choice, connection setup, pooling, and migrations.

## Encryption Shape

```ts
type EncryptionKey = {
  version: string;
  key: string | Uint8Array | CryptoKey;
};

type EncryptionConfig = {
  current: EncryptionKey;
  previous?: EncryptionKey[];
};
```

Save flow:

1. Core validates input and derives normalized metadata.
2. Adapter serializes `{ apiKey }`.
3. Adapter encrypts with `encryption.current`.
4. Adapter upserts metadata, ciphertext, nonce, and key version.
5. Adapter returns metadata only.

Read flow:

1. Adapter reads metadata, ciphertext, nonce, and key version.
2. Adapter finds a matching configured key.
3. Adapter decrypts in application memory.
4. Adapter returns internal plaintext credentials to core.
5. Core proxy-wraps credentials before returning public values.

## Storage Shape

The logical schema:

```text
id text primary key
user_id text not null
provider text not null
label text not null
key_hint text not null
credentials_ciphertext text not null
credentials_nonce text not null
encryption_key_version text not null
created_at text or timestamp not null
updated_at text or timestamp not null
```

Required constraints and indexes:

- unique `(user_id, provider, label)`;
- index for list queries by `user_id`, `updated_at`, and `created_at`.

The initial implementation may use a Postgres-specific Drizzle schema export, but the column names and serialized values should stay compatible with a future SQLite schema.

## Milestones

- Milestone 1: Add package scaffold, exports, peer dependency metadata, and Postgres schema/migration artifacts.
- Milestone 2: Add encryption configuration validation and authenticated encryption helpers.
- Milestone 3: Implement Drizzle adapter save/list/get/getById/delete behavior for Postgres.
- Milestone 4: Add focused unit and integration tests for adapter behavior, encryption, key versions, and error redaction.
- Milestone 5: Update docs, threat model, and spec task status.

## Verification

- Run focused Drizzle adapter tests during implementation.
- Run `npm run typecheck`.
- Run `npm run test`.
- Run `npm run build`.
- Run `npm run check` before release-oriented completion.
- Verify package entrypoints remain ESM and do not add Node-only top-level imports unnecessarily.

