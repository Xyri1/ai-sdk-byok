# Decisions: Key-Id Retrieval and Optional Credential Cache

## Accepted

- Treat `KeyMetadata.id` as the public database-wide unique `keyId`.
- Add key-id based credential retrieval with `keys.getById({ userId, keyId })`.
- Return a public `KeyCredentialRecord` from `getById`, containing metadata plus proxy-wrapped credentials.
- Use internal `StoredKeyCredentialRecord` values for storage and cache contracts.
- Use returned metadata, not browser-provided provider values, for provider selection in server routes.
- Keep `keys.get({ userId, provider, label })` returning only proxy-wrapped credentials or `null` for compatibility.
- Require `userId` on `getById`; a `keyId` is not a bearer authorization token.
- Trust server-authenticated identity, not browser-provided identity, when deriving cache keys.
- Make credential caching opt-in and disabled by default.
- Export the generic cache wrapper from core as `cachedStorage`.
- Define a generic cache interface in this scope, not a first-party Redis client adapter.
- Wire the example app to Redis as app-owned code using the generic cache interface.
- Prefer cache behavior as a storage wrapper or adapter composition layer.
- Keep `cachedStorage` below the manager; it must return `StoredKeyCredentialRecord` values and never proxy-wrap credentials.
- Keep credential caching storage-adapter agnostic.
- Do not couple the cache wrapper to Supabase RPC names, Vault internals, or table names.
- Treat the Supabase adapter as the first concrete adapter updated for the new core contract.
- Scope credential cache entries by trusted server-side `userId` plus `keyId`.
- Allow cache hits to avoid Postgres ownership reads when the cache key is derived from authenticated server-side identity.
- Cache internal serializable `StoredKeyCredentialRecord` values needed by `getById`; do not cache public proxy-wrapped records.
- Do not add separate metadata/list caching in this scope.
- Require explicit short TTLs for credential caches.
- Recommend 30 to 120 seconds as the default TTL range for credential records.
- Invalidate cache entries on save/rotation and delete.
- Use normalized returned metadata, specifically `{ userId: metadata.userId, keyId: metadata.id }`, for save/rotation invalidation.
- Delete cache entries before and after the underlying storage delete.
- Use post-delete invalidation to remove stale cache entries that may be repopulated by concurrent reads during the delete window.
- Invalidate, rather than eagerly repopulate, credential cache entries after rotation.
- Fail closed on save/rotation and delete when required credential cache invalidation fails.
- Define fail-closed invalidation as an error-reporting guarantee, not a rollback guarantee across storage and cache.
- Fall back to the underlying storage adapter by default when read-path cache access fails.
- Do not add a fail-on-cache-read-error option in this scope.
- Document Redis and equivalent backends as trusted secret infrastructure when used for credential records that include plaintext credentials.

## Deferred

- Whether cache key hashing is implemented by the package or left to cache adapter implementations.
