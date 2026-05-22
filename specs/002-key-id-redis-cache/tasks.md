# Tasks: Key-Id Retrieval and Optional Credential Cache

## Core Package

- [x] Add `GetKeyByIdInput`.
- [x] Add `GetStorageByIdInput`.
- [x] Add `keys.getById({ userId, keyId })` to public manager types.
- [x] Add a public credential-record return type containing metadata plus credentials.
- [x] Name the public credential-record return type `KeyCredentialRecord`.
- [x] Add an internal serializable credential-record type named `StoredKeyCredentialRecord`.
- [x] Keep `keys.get({ userId, provider, label })` returning only credentials or `null`.
- [x] Add storage adapter `getById(input)` contract.
- [x] Validate `keyId` as a non-empty string up to 128 characters before storage or cache calls.
- [x] Proxy-wrap credentials inside records returned from `getById`.
- [x] Add unit tests for `getById` validation failures.
- [x] Add unit tests rejecting empty and over-128-character `keyId` values for `getById`.
- [x] Add unit tests for `getById` returning `null`.
- [x] Add unit tests for `getById` credential proxy wrapping and serialization protection.

## Supabase Adapter

- [x] Add adapter `getById({ userId, keyId })`.
- [x] Call `ai_sdk_byok_get_credentials_by_id`.
- [x] Parse returned metadata using the same metadata shape as `save` and `list`.
- [x] Parse returned credentials using the same shape checks as label-based `get`.
- [x] Wrap Supabase failures as `AiSdkByokAdapterError`.
- [x] Add mocked adapter tests for successful key-id retrieval.
- [x] Add mocked adapter tests for missing key-id retrieval.
- [x] Add mocked adapter tests for malformed credential payloads.

## SQL Migration

- [x] Add migration for `public.ai_sdk_byok_get_credentials_by_id(p_user_id text, p_key_id uuid)`.
- [x] Ensure the RPC checks both `id = p_key_id` and `user_id = p_user_id`.
- [x] Ensure the RPC is `SECURITY DEFINER`.
- [x] Ensure the RPC sets `search_path = ''`.
- [x] Ensure all database objects are fully qualified.
- [x] Revoke execution from `PUBLIC`, `anon`, and `authenticated`.
- [x] Grant execution only to `service_role`.
- [x] Keep `supabase/migrations` and `packages/supabase/migrations` copies in sync.

## Optional Credential Cache

- [x] Define a generic cache backend interface for internal serializable credential records.
- [x] Export the generic cache wrapper from core as `cachedStorage`.
- [x] Define cache wrapper options, including explicit TTL.
- [x] Keep cache wrapper dependencies limited to the core storage contract.
- [x] Ensure cache wrapper has no Supabase-specific RPC, Vault, or table assumptions.
- [x] Ensure `cachedStorage` returns `StoredKeyCredentialRecord` values and never proxy-wraps credentials.
- [x] Ensure cache backends do not store public proxy-wrapped `KeyCredentialRecord` values.
- [x] Ensure cache backends store only `StoredKeyCredentialRecord` values.
- [x] Reject or fail configuration when credential cache TTL is missing.
- [x] Implement `getById` cache read-through behavior.
- [x] Populate cache after successful storage fallback.
- [x] Fall back to storage by default on read-path cache failures.
- [x] Invalidate cache on `save` using `{ userId: metadata.userId, keyId: metadata.id }` after storage returns metadata.
- [x] Invalidate cache before and after `delete`.
- [x] Fail closed on `save` when required invalidation fails.
- [x] Fail closed on `delete` when required invalidation fails.
- [x] Document fail-closed invalidation as an error-reporting guarantee, not storage rollback.
- [x] Add tests for cache hit behavior without storage read.
- [x] Add tests that cached records are proxy-wrapped by the manager before public return.
- [x] Add tests for cache miss storage fallback and cache population.
- [x] Add tests for default cache read failure fallback.
- [x] Add tests for save invalidation using normalized returned metadata.
- [x] Add tests that delete invalidation runs before and after the storage delete.
- [x] Add tests for invalidation failure after successful storage mutation.
- [x] Add tests for invalidation failure behavior.

## Example App

- [x] Update selected-key chat route to retrieve credentials by `keyId`.
- [x] Update model-listing route to retrieve credentials by `keyId`.
- [x] Use returned metadata, not browser-provided provider values, for provider selection.
- [x] Keep trusted `userId` derivation in server-only code.
- [x] Ensure Client Components pass only metadata ids and never plaintext credentials.
- [x] Keep browser-visible responses metadata-only.
- [x] Avoid returning or logging plaintext credentials.
- [x] Update `examples/nextjs-supabase/README.md` to explain key-id based retrieval.
- [x] Add optional app-owned Redis cache wiring using the generic cache interface.
- [x] Gate Redis cache wiring behind server-only environment variables.
- [x] Document that the Redis example stores plaintext credentials and is trusted secret infrastructure.
- [x] Document that the Redis example does not imply a first-party Redis client adapter package.

## Documentation

- [x] Document `keys.getById`.
- [x] Document key-id based provider construction.
- [x] Document that credential caching uses a generic cache interface and is adapter-agnostic.
- [x] Document Supabase as the first concrete adapter implementation, not a cache requirement.
- [x] Document Redis-backed credential cache as opt-in app wiring.
- [x] Document that separate metadata/list caching is out of scope.
- [x] Document trusted server-side identity requirements for cache key derivation.
- [x] Document TTL and invalidation behavior.
- [x] Update architecture docs.
- [x] Update threat model for Redis compromise and stale-cache revocation windows.
- [x] Update package README examples if public API examples change.

## Verification

- [x] `npm run typecheck`
- [x] `npm run test`
- [x] `npm run build`
- [x] `npm run lint`
- [x] `npm run check`
