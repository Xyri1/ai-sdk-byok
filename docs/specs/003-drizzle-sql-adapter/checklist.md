# Checklist: Drizzle SQL Adapter

## Spec Completeness

- [x] Defines why a Drizzle SQL adapter is needed.
- [x] Defines `@ai-sdk-byok/drizzle` as the package name.
- [x] Defines `drizzleAdapter` as the primary export.
- [x] Defines Postgres as the first supported dialect.
- [x] Defers SQLite implementation while preserving a portable logical model.
- [x] Requires application-side authenticated encryption.
- [x] States that the master key is never stored in SQL.
- [x] Excludes SQL-side encryption and `pgcrypto` plaintext handling.
- [x] Defines key versions for controlled master-key rotation.
- [x] Defines previous-key read support.
- [x] Defines compromise guidance for leaked master keys.
- [x] Defines the logical table shape.
- [x] Defines constraints and indexes.
- [x] Defines ciphertext and nonce storage as base64url text.
- [x] Preserves existing core credential-safety invariants.
- [x] Defines adapter threat-model boundaries.
- [x] Defines documentation and test requirements.

## Open Questions

- [ ] Which authenticated encryption primitive should the implementation use?
- [ ] Should the first release include a re-encryption maintenance helper?
- [ ] Should migrations ship as raw SQL, Drizzle Kit schema files, or both?
