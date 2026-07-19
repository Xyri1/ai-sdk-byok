# Decisions: Drizzle SQL Adapter

## Accepted

- Publish the adapter as `@ai-sdk-byok/drizzle`.
- Name the primary export `drizzleAdapter`.
- Treat this as a Drizzle-backed encrypted SQL adapter, not a Postgres-only product concept.
- Support Postgres first.
- Defer SQLite implementation while keeping the logical storage model portable.
- Require explicit dialect selection.
- Accept caller-owned Drizzle database instances.
- Do not create database connections inside the package.
- Use application-side authenticated encryption.
- Use AES-256-GCM with a 32-byte base64 master-key representation, a random 12-byte nonce per write, and AAD bound to `(userId, provider)`.
- Do not use SQL-side encryption or decryption for credential payloads.
- Do not use `pgcrypto` for plaintext credential handling.
- Keep the master key outside SQL.
- Store key versions in SQL as non-secret identifiers.
- Store ciphertext and nonce as base64url text for portability.
- Generate `id` values in application code instead of relying on dialect-specific UUID defaults.
- Support one `current` encryption key and optional `previous` keys.
- Use `current` for all new writes.
- Use matching `previous` keys only for decrypting existing rows.
- Support controlled key rotation by reading previous key versions.
- Defer first-party bulk re-encryption tooling unless implementation planning decides it is small enough for the initial slice.
- Document master-key compromise as a credential exposure event when ciphertext may also have been exposed.
- Preserve the existing manager-level credential proxy and metadata-only response guarantees.

## Deferred

- Whether to add a first-party re-encryption maintenance helper in the initial release.
- SQLite schema exports and SQLite integration tests.
