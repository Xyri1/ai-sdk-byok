# Tasks: Drizzle SQL Adapter

## Package

- [x] Scaffold `packages/drizzle`.
- [x] Add package metadata for `@ai-sdk-byok/drizzle`.
- [x] Add ESM package exports.
- [x] Add Drizzle peer dependency metadata.
- [x] Wire the package into workspace scripts and build config.

## Schema And Migrations

- [x] Add Postgres Drizzle schema export.
- [x] Add Postgres migration SQL or migration guidance.
- [x] Create `ai_sdk_byok_keys` equivalent table for encrypted SQL storage.
- [x] Add unique constraint on `(user_id, provider, label)`.
- [x] Add list-query index for `(user_id, updated_at, created_at)`.
- [x] Store ciphertext and nonce as base64url text.
- [x] Generate ids in application code.

## Encryption

- [x] Define encryption config types.
- [x] Validate empty key versions.
- [x] Validate duplicate key versions.
- [x] Normalize accepted key material inputs.
- [x] Implement authenticated encryption.
- [x] Implement authenticated decryption.
- [x] Ensure new writes use `current`.
- [x] Ensure reads use the key matching the stored key version.
- [x] Fail safely when a row references an unconfigured key version.
- [x] Ensure encryption helpers do not log or expose plaintext, ciphertext, nonce, or key material in errors.

## Adapter

- [x] Implement `drizzleAdapter`.
- [x] Require explicit `dialect`.
- [x] Support `dialect: 'postgres'`.
- [x] Reject unsupported dialects.
- [x] Accept caller-owned Drizzle database instances.
- [x] Implement `save`.
- [x] Implement `list`.
- [x] Implement `get`.
- [x] Implement `getById`.
- [x] Implement `delete`.
- [x] Return metadata only from `save` and `list`.
- [x] Keep ciphertext, nonce, and key version out of public metadata.
- [x] Wrap database and crypto failures as adapter errors.
- [x] Redact adapter errors.

## Tests

- [x] Add adapter tests for save/list/get/getById/delete.
- [x] Add tests for metadata-only `save` and `list`.
- [x] Add tests that SQL rows contain ciphertext rather than plaintext credentials.
- [x] Add tests that public metadata does not expose ciphertext, nonce, or key version.
- [x] Add tests for previous-key read support.
- [x] Add tests that new writes use `current`.
- [x] Add tests for duplicate and invalid key-version configuration.
- [x] Add tests for missing key version failure.
- [x] Add tests for adapter error redaction.
- [x] Add tests for list ordering by `updatedAt` descending and then `createdAt` descending.
- [x] Add tests for idempotent delete behavior through the public manager.

## Documentation

- [x] Add package README.
- [x] Update root README when public install examples change.
- [x] Update architecture docs.
- [x] Update threat model.
- [x] Update agent implementation guidance or add a Drizzle integration guide.
- [x] Document that the master key is never stored in SQL.
- [x] Document that losing the master key makes stored credentials unrecoverable.
- [x] Document breach guidance for leaked master keys.
- [x] Document that this adapter protects against database-only compromise, not app-server compromise.

## Verification

- [x] `npm run typecheck`
- [x] `npm run test`
- [x] `npm run build`
- [x] `npm run check`
