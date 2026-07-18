# Checklist: Key-Id Retrieval and Optional Credential Cache

## Spec Completeness

- [x] Defines why key-id based retrieval is needed.
- [x] Defines the relationship between `KeyMetadata.id` and `keyId`.
- [x] Defines `getById` as returning metadata plus credentials for server-side provider selection.
- [x] Names the public `getById` return shape as `KeyCredentialRecord`.
- [x] Names the internal storage/cache return shape as `StoredKeyCredentialRecord`.
- [x] Keeps v0.1 label-based retrieval compatible.
- [x] Keeps existing `keys.get` return semantics unchanged.
- [x] Defines credential caching as opt-in.
- [x] Defines credential caching through a generic cache interface.
- [x] Defines `cachedStorage` as the core cache wrapper export.
- [x] Defines `cachedStorage` as a storage-wrapper that does not proxy-wrap credentials.
- [x] Distinguishes internal serializable cache records from public proxy-wrapped records.
- [x] Defines credential caching as adapter-agnostic.
- [x] Identifies Supabase as the first concrete adapter implementation.
- [x] Defines how Redis cache hits can avoid Postgres reads.
- [x] Defines user isolation through trusted `userId + keyId` cache keys.
- [x] Excludes separate metadata/list caching from this scope.
- [x] Defines required Next.js Supabase example app updates.
- [x] Defines optional app-owned Redis wiring in the example app.
- [x] Defines invalidation behavior for rotation and deletion.
- [x] Defines save invalidation using normalized returned metadata.
- [x] Defines failure behavior for invalidation errors.
- [x] Defines cache read failure fallback as default-only behavior.
- [x] Clarifies fail-closed invalidation as error reporting rather than storage rollback.
- [x] Defines delete double-invalidation race handling.
- [x] Documents Redis as trusted secret infrastructure.

## Open Questions

- [ ] Should hashed cache keys be built into the package?
