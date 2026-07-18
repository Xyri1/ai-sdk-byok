# Tasks: Drizzle SQL Adapter

## Package

- [ ] Scaffold `packages/drizzle`.
- [ ] Add package metadata for `@ai-sdk-byok/drizzle`.
- [ ] Add ESM package exports.
- [ ] Add Drizzle peer dependency metadata.
- [ ] Wire the package into workspace scripts and build config.

## Schema And Migrations

- [ ] Add Postgres Drizzle schema export.
- [ ] Add Postgres migration SQL or migration guidance.
- [ ] Create `ai_sdk_byok_keys` equivalent table for encrypted SQL storage.
- [ ] Add unique constraint on `(user_id, provider, label)`.
- [ ] Add list-query index for `(user_id, updated_at, created_at)`.
- [ ] Store ciphertext and nonce as base64url text.
- [ ] Generate ids in application code.

## Encryption

- [ ] Define encryption config types.
- [ ] Validate empty key versions.
- [ ] Validate duplicate key versions.
- [ ] Normalize accepted key material inputs.
- [ ] Implement authenticated encryption.
- [ ] Implement authenticated decryption.
- [ ] Ensure new writes use `current`.
- [ ] Ensure reads use the key matching the stored key version.
- [ ] Fail safely when a row references an unconfigured key version.
- [ ] Ensure encryption helpers do not log or expose plaintext, ciphertext, nonce, or key material in errors.

## Adapter

- [ ] Implement `drizzleAdapter`.
- [ ] Require explicit `dialect`.
- [ ] Support `dialect: 'postgres'`.
- [ ] Reject unsupported dialects.
- [ ] Accept caller-owned Drizzle database instances.
- [ ] Implement `save`.
- [ ] Implement `list`.
- [ ] Implement `get`.
- [ ] Implement `getById`.
- [ ] Implement `delete`.
- [ ] Return metadata only from `save` and `list`.
- [ ] Keep ciphertext, nonce, and key version out of public metadata.
- [ ] Wrap database and crypto failures as adapter errors.
- [ ] Redact adapter errors.

## Tests

- [ ] Add adapter tests for save/list/get/getById/delete.
- [ ] Add tests for metadata-only `save` and `list`.
- [ ] Add tests that SQL rows contain ciphertext rather than plaintext credentials.
- [ ] Add tests that public metadata does not expose ciphertext, nonce, or key version.
- [ ] Add tests for previous-key read support.
- [ ] Add tests that new writes use `current`.
- [ ] Add tests for duplicate and invalid key-version configuration.
- [ ] Add tests for missing key version failure.
- [ ] Add tests for adapter error redaction.
- [ ] Add tests for list ordering by `updatedAt` descending and then `createdAt` descending.
- [ ] Add tests for idempotent delete behavior through the public manager.

## Documentation

- [ ] Add package README.
- [ ] Update root README when public install examples change.
- [ ] Update architecture docs.
- [ ] Update threat model.
- [ ] Update agent implementation guidance or add a Drizzle integration guide.
- [ ] Document that the master key is never stored in SQL.
- [ ] Document that losing the master key makes stored credentials unrecoverable.
- [ ] Document breach guidance for leaked master keys.
- [ ] Document that this adapter protects against database-only compromise, not app-server compromise.

## Verification

- [ ] `npm run typecheck`
- [ ] `npm run test`
- [ ] `npm run build`
- [ ] `npm run check`

