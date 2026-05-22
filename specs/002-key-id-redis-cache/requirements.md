# Requirements: Key-Id Retrieval and Optional Credential Cache

## Status

Draft.

## Problem

The v0.1 credential retrieval API supports `keys.get({ userId, provider, label })`. That works for label-oriented integrations, but app routes commonly receive a selected metadata id from the browser after `keys.list()`.

For serverless platforms such as Vercel, per-request provider construction is the safe default. Each request can retrieve plaintext credentials from Supabase Vault and inject `credentials.apiKey` into an AI SDK provider factory. This keeps Vercel functions stateless, but it requires a Supabase/Postgres read and Vault decrypt on every credential retrieval.

Apps that need lower per-request latency may want an external cache such as Redis. To make that cache efficient, credential retrieval needs a stable database-wide `keyId`, and cache hits need to avoid a Postgres ownership read while preserving per-user isolation.

## Goals

- Add key-id based credential retrieval.
- Allow server routes to construct AI SDK providers from selected metadata ids.
- Update the Next.js Supabase example app to demonstrate key-id based provider construction.
- Support optional credential-record caching through a generic cache interface and adapter-agnostic wrapper layer.
- Allow Redis cache hits to avoid Postgres reads when cache keys are derived from trusted server-side identity.
- Preserve v0.1 credential-safety invariants by default.
- Make credential caching with Redis-style backends an explicit security tradeoff, not the default behavior.

## Non-Goals

- Do not replace Supabase Vault as durable storage.
- Do not make Redis required.
- Do not expose plaintext credentials to browser code.
- Do not treat `keyId` as a bearer authorization token.
- Do not add browser-side provider construction.
- Do not add multi-field credentials, OAuth, refresh tokens, or provider-specific credential shapes.
- Do not guarantee immediate global revocation across cache regions beyond the configured invalidation and TTL behavior.

## Functional Requirements

- `KeyMetadata.id` is the public database-wide unique key id.
- The core manager exposes `keys.getById(input)`.
- The core storage adapter contract includes key-id based retrieval.
- `keys.getById({ userId, keyId })` returns a server-side credential record or `null`.
- The public return type is named `KeyCredentialRecord`.
- `KeyCredentialRecord` contains safe metadata plus proxy-wrapped `{ apiKey }` credentials.
- Storage adapters and cache backends return an internal serializable type named `StoredKeyCredentialRecord`.
- `StoredKeyCredentialRecord` contains the same metadata as `KeyCredentialRecord` plus unwrapped `{ apiKey }` credentials.
- Credential record metadata includes at least `id`, `userId`, `provider`, `label`, `keyHint`, `createdAt`, and `updatedAt`.
- `keys.getById` requires both `userId` and `keyId`.
- `keyId` alone is not authorization.
- Existing `keys.get({ userId, provider, label })` remains supported for compatibility.
- Existing `keys.get({ userId, provider, label })` continues to return only proxy-wrapped `{ apiKey }` credentials or `null`; it does not return metadata.
- Existing `keys.save`, `keys.list`, `keys.get`, and `keys.delete` behavior remains unchanged unless an optional cache wrapper is configured.
- Storage adapters that participate in this scope support retrieval by `{ userId, keyId }`.
- The Supabase adapter is the first concrete adapter updated to support key-id retrieval.
- The Supabase SQL function for key-id retrieval checks both `id = p_key_id` and `user_id = p_user_id`.
- The Supabase SQL function for key-id retrieval returns metadata needed for server-side provider selection together with the credential payload.
- Browser-visible UI may pass `keyId` back to trusted server routes, but trusted server routes derive `userId` from authentication/session state.

## Example App Requirements

- The `examples/nextjs-supabase` app is in scope for this spec.
- The example chat route uses `keys.getById({ userId, keyId })` for provider construction and reads provider selection from returned metadata.
- The example model-listing route uses `keys.getById({ userId, keyId })` when fetching provider model lists and reads provider selection from returned metadata.
- Example routes derive `userId` from trusted server-side context. The current demo user helper may continue to stand in for real auth.
- Example routes may receive `keyId` from browser-visible metadata.
- Example routes must not trust browser-provided provider values for routing plaintext credentials to provider APIs.
- Example routes must not retrieve plaintext credentials in Client Components.
- Example routes must not return plaintext credentials in JSON responses, streamed responses, action results, or error payloads.
- Example routes must not log plaintext credentials.
- The example UI remains metadata-only: provider, label, key hint, timestamps, and id are allowed.
- The example app documentation explains that `keyId` is a selector, while server-side `userId` remains the authorization boundary.
- The example app includes optional Redis-backed cache wiring against the generic cache interface.
- The Redis-backed example must be server-only, opt-in, and disabled unless required environment variables are present.
- The Redis-backed example does not imply a first-party Redis package adapter.

## Optional Credential Cache Requirements

- Credential caching is opt-in and disabled by default.
- The core package exports a generic cache wrapper named `cachedStorage`.
- This scope defines a generic cache interface, not a first-party Redis client adapter.
- Redis is an example backend an app may connect to the generic cache interface.
- Cache behavior is implemented as a storage-adapter wrapper or adapter composition layer.
- Cache behavior is storage-adapter agnostic and depends only on the core storage contract.
- Cache behavior must not depend on Supabase-specific RPC names, Vault secret ids, table names, or database implementation details.
- The core manager continues to own validation and proxy wrapping.
- `cachedStorage` operates below the core manager and must not proxy-wrap credentials.
- The durable source of truth remains the underlying storage adapter, such as Supabase Vault.
- Any storage adapter can be wrapped by the same cache layer if it implements `getById`, returns stable metadata ids from `save`, and deletes by `{ userId, keyId }`.
- Cache entries are scoped by trusted server-side `userId` plus `keyId`.
- Cache keys must not be derived from browser-provided `userId` values.
- Recommended logical cache key shape is `ai-sdk-byok:credentials:v1:<userId>:<keyId>`.
- Implementations may use a hashed equivalent of the `userId:keyId` tuple to avoid exposing raw user ids in Redis key names.
- Cache values contain `StoredKeyCredentialRecord` values with metadata required for provider selection and unwrapped plaintext credentials.
- Cache backends must not store public proxy-wrapped `KeyCredentialRecord` values because proxy-wrapped credentials intentionally reject JSON serialization.
- Public `KeyCredentialRecord` values are created by the core manager after the cache wrapper or storage adapter returns `StoredKeyCredentialRecord`.
- Cache hits for `getById({ userId, keyId })` may return credential records without a Postgres ownership read.
- Cache misses fall back to the underlying storage adapter.
- Successful cache-miss retrieval may populate the cache.
- Credential cache entries require an explicit TTL.
- Recommended credential cache TTL is 30 to 120 seconds.
- Separate metadata/list caching is out of scope for this spec.

## Cache Invalidation Requirements

- `save`/rotation invalidates the credential cache entry using `{ userId: metadata.userId, keyId: metadata.id }` from the normalized metadata returned by storage.
- `delete({ userId, keyId })` invalidates the credential cache entry for the deleted key.
- Delete invalidation should run before and after the underlying storage delete.
- Pre-delete invalidation reduces use of an already cached credential during deletion.
- Post-delete invalidation removes any stale credential repopulated by a concurrent `getById` that read from storage during the delete window.
- Rotation should invalidate rather than eagerly cache the new plaintext credential by default.
- When credential caching is enabled, required invalidation failure for `save`/rotation fails the public operation.
- When credential caching is enabled, required invalidation failure for `delete` fails the public operation.
- Cache invalidation is not transactional with the underlying storage adapter.
- When invalidation fails after a durable save, rotation, or delete has already succeeded, fail closed means the public operation returns an error and does not report success.
- Fail-closed invalidation does not imply rollback of the underlying storage operation.
- Callers must treat invalidation errors after storage mutation as ambiguous completion and may retry the operation.
- Read-path cache failures fall back to the underlying storage adapter by default.
- This spec does not add a fail-on-cache-read-error option.
- TTL defines the maximum stale credential window when invalidation is bypassed by infrastructure failure outside the operation's control.

## Validation Requirements

- `userId`: non-empty string, max 256 characters.
- `keyId`: non-empty string, max 128 characters.
- For the Supabase adapter, `keyId` must be passed to RPC as a UUID-compatible value.
- Validation failures throw `AiSdkByokValidationError` before storage adapter calls.

## Security Requirements

- `save` and `list` never return plaintext credentials.
- Public metadata never exposes `vault_secret_id` or equivalent storage-secret identifiers.
- Plaintext credentials are returned only by explicit credential retrieval calls.
- Returned credentials remain proxy-wrapped so object-level string coercion and `JSON.stringify` do not leak secrets.
- Redis or any other credential cache backend that stores plaintext credentials becomes trusted secret infrastructure.
- Cache backends that store plaintext credentials must not be reachable from browser code.
- Cache keys, logs, errors, traces, and metrics must not include plaintext credentials.
- Redis command logging, debug tooling, dashboards, and observability integrations must be treated as potential secret exposure paths.
- A compromised Redis instance is a plaintext credential compromise for cached entries.
- A stale Redis entry after rotation or deletion is a revocation delay bounded by invalidation behavior and TTL.

## Runtime Requirements

- Package entrypoints continue to support Node.js 22 or newer.
- Core and Supabase package entrypoints remain Edge-compatible ESM.
- Optional cache integrations must not add Node-only top-level imports to core package entrypoints.
- Apps are responsible for choosing cache backends compatible with their server runtime.
