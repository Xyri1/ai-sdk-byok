# Requirements: Drizzle SQL Adapter

## Status

Draft.

## Problem

The current durable storage adapter requires Supabase Vault. That is a good fit for Supabase applications, but it blocks applications that already use Drizzle with their own SQL database.

Applications in this audience often want BYOK credential storage without adopting a cloud secret manager or Supabase Vault. The package can support them by encrypting credentials in trusted server-side application code and storing only metadata plus ciphertext in SQL.

## Goals

- Add a first-party Drizzle-backed SQL adapter package named `@ai-sdk-byok/drizzle`.
- Support Postgres first.
- Keep the logical schema and serialized encrypted payload format portable enough for future SQLite support.
- Use application-side authenticated encryption with a caller-supplied master key.
- Store only metadata, ciphertext, nonce, and non-secret key version in SQL.
- Keep the master key outside SQL.
- Preserve the existing core manager safety model and storage contract.
- Protect against database-only compromise, leaked backups, SQL dumps, and read replicas.
- Support controlled master-key rotation through configured key versions.

## Non-Goals

- Do not store the master key in SQL.
- Do not use SQL-side encryption or decryption for credential payloads.
- Do not rely on `pgcrypto` for plaintext credential handling.
- Do not claim protection against compromised application servers, leaked master keys, malicious trusted-server dependencies, or plaintext logging by the host application.
- Do not support browser-side credential storage or provider construction.
- Do not add multi-field credentials, OAuth, refresh tokens, or provider-specific credential shapes.
- Do not require AWS, GCP, Azure, or another external secrets manager.
- Do not promise universal SQL behavior across all dialects in this scope.
- Do not implement SQLite support in this scope.

## Functional Requirements

- The package exposes `drizzleAdapter` from `@ai-sdk-byok/drizzle`.
- `drizzleAdapter` accepts a caller-owned Drizzle database instance.
- `drizzleAdapter` requires an explicit `dialect` option.
- The only supported initial dialect is `postgres`.
- The adapter satisfies the existing core storage contract.
- `save` stores or rotates one credential for `(userId, provider, label)` and returns metadata only.
- `list` returns metadata for a user, ordered by `updatedAt` descending and then `createdAt` descending.
- `get` returns credentials for `(userId, provider, label)` or `null`.
- `getById` returns metadata plus credentials for `(userId, keyId)` or `null`.
- `delete` deletes by `(userId, keyId)`.
- Public metadata never exposes ciphertext, nonce, key version, or storage-specific internals.
- The package provides a Postgres Drizzle schema export.
- The package provides Postgres migration guidance or migration SQL.
- The package does not create database connections or own connection pooling.

## Encryption Requirements

- The adapter encrypts credentials in application code before database writes.
- The adapter decrypts credentials in application code after database reads.
- SQL must never receive plaintext credentials, serialized credential payloads, or master-key material.
- The encrypted plaintext payload is exactly the JSON representation of `{ apiKey: string }`.
- Encryption must be authenticated.
- New writes use the configured `current` encryption key.
- Existing rows are decrypted using the configured key whose version matches the row's stored `encryption_key_version`.
- Duplicate key versions are invalid.
- Empty key versions are invalid.
- Missing decryption keys fail as adapter errors.
- Key versions are non-secret identifiers and may be stored in SQL.
- Key material is never stored in SQL.

## Key Rotation Requirements

- The encryption config supports one `current` key and optional `previous` keys.
- `current` is used for all new writes and rotations.
- `previous` keys are read-only and used only to decrypt existing rows.
- Deploying a new `current` key while keeping the old key in `previous` keeps old rows readable.
- Re-encryption of old rows may be deferred.
- If a master key leaks, rows encrypted under that key must be treated as compromised when ciphertext may also have been exposed.
- Re-encrypting with a new master key stops continued reliance on the leaked key but does not retroactively protect already decryptable data.
- Documentation must tell applications to have affected users rotate provider API keys when both ciphertext and a matching leaked master key may have been exposed.

## Storage Requirements

- The logical table stores `id`.
- The logical table stores `user_id`.
- The logical table stores `provider`.
- The logical table stores `label`.
- The logical table stores `key_hint`.
- The logical table stores `credentials_ciphertext`.
- The logical table stores `credentials_nonce`.
- The logical table stores `encryption_key_version`.
- The logical table stores `created_at`.
- The logical table stores `updated_at`.
- The table has a unique constraint on `(user_id, provider, label)`.
- The table has an index supporting list queries by `user_id`, `updated_at`, and `created_at`.
- `id` is generated in application code.
- Ciphertext and nonce are stored as base64url text to avoid Postgres `bytea` versus SQLite `blob` differences later.
- Timestamps are generated or normalized so ordering behavior matches the core requirements.

## Security Requirements

- `save` and `list` never return plaintext credentials.
- Plaintext credentials are returned only by explicit credential retrieval calls.
- Returned public credentials remain proxy-wrapped by the core manager.
- Adapter errors never include plaintext credentials, serialized credential payloads, encryption keys, ciphertext, or nonces.
- The adapter protects against database-only compromise, leaked database backups, SQL dumps, read-only database compromise, and exposed read replicas.
- The adapter does not protect against compromised application server processes, leaked master keys, malicious trusted-server dependencies, host application logs that include plaintext credentials, or attackers who obtain both ciphertext and the matching master key.

## Runtime Requirements

- Package entrypoints support Node.js 22 or newer.
- Package source avoids Node-only top-level imports where practical.
- The adapter remains ESM-only.
- Applications are responsible for choosing a Drizzle driver compatible with their server runtime.

