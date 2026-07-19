# Guide: Credential Caching with `cachedStorage`

`cachedStorage` wraps any storage adapter with a read-path cache for `keys.getById`. It is optional, off unless you wire a cache backend, and only worth adding when the same key is retrieved repeatedly in a hot path (e.g. every chat request) and your durable storage round-trip is the bottleneck.

Cache entries contain **plaintext credential records**. Everything in this guide follows from that fact.

## When to use it

Use it when:

- `getById` runs on a hot request path and storage latency is measurable.
- You already operate (or are on a platform that provides) a server-only cache: Workers KV, Redis, etc.

Skip it when:

- Key retrieval is occasional — durable storage is fast enough.
- You cannot guarantee the cache is server-only trusted infrastructure.

Only `getById` is cached. `get`, `list`, `save`, and `delete` always hit durable storage; metadata/list caching is intentionally out of scope.

## Usage

```ts
import { cachedStorage, createByokManager } from 'ai-sdk-byok';

export const byok = createByokManager({
  storage: cachedStorage({
    storage: durableAdapter,     // any adapter: supabaseAdapter, d1Adapter, drizzleAdapter
    cache: credentialCache,      // a CredentialRecordCache implementation
    ttlMs: 60_000,               // required, positive
  }),
});
```

On Cloudflare, `@ai-sdk-byok/cloudflare` ships a first-party backend, `kvCredentialCache`, which seals cached records with AES-256-GCM before they touch KV — see the [Cloudflare guide](cloudflare.md). For Redis and everything else, you implement the backend yourself; there is deliberately no first-party Redis package.

## Implementing a cache backend

A backend implements `CredentialRecordCache` (exported from `ai-sdk-byok`):

```ts
interface CredentialRecordCache {
  get(input: { userId: string; keyId: string }): Promise<StoredKeyCredentialRecord | null>;
  set(
    input: { userId: string; keyId: string },
    record: StoredKeyCredentialRecord,
    options: { ttlMs: number },
  ): Promise<void>;
  delete(input: { userId: string; keyId: string }): Promise<void>;
}
```

Rules for implementations:

- **Derive cache keys from the given `userId` + `keyId`** — these arrive already validated and, in a correct integration, from trusted server-side auth. Hash the tuple (e.g. SHA-256) if your cache keys are externally visible, as `kvCredentialCache` does.
- **Honor `ttlMs`** with the backend's native expiry (`EX`/`PX` in Redis, `expirationTtl` in KV). Cached values must not outlive it.
- **Return `null` on miss or malformed data** — never throw for a miss.
- The record you store contains a plaintext `credentials.apiKey`. Encrypting values before they reach the backend (as the KV cache does) is a strong upgrade, not a requirement — but see the safety rules below either way.

## Failure semantics

`cachedStorage` is deliberately biased toward availability on reads and toward loud failures on writes:

| Situation | Behavior |
| --- | --- |
| Cache `get` throws | Falls through to durable storage; the request succeeds. |
| Cache `set` (population) throws | Ignored; storage remains the source of truth. |
| Invalidation during `save`/`delete` throws | Best-effort, swallowed; the TTL bounds how long a stale credential survives. |
| Durable storage throws | The error propagates — caching never masks storage failures. |

`save` invalidates the saved key's cache entry after writing; `delete` invalidates before **and** after durable deletion. Invalidation is not transactional with storage: after a rotation or delete, a cached copy of the old credential can be served until its TTL expires (plus cross-region propagation on eventually-consistent backends like KV).

## Choosing a TTL

Use 30–120 seconds. The TTL is your revocation window: after a user deletes or rotates a key, a stale cached credential may keep working for up to that long. Longer TTLs buy latency you usually don't need at a revocation cost you usually can't afford. `ttlMs` is required and must be positive — there is no default.

## Safety rules

- The cache is **trusted secret infrastructure**: server-only, never reachable from browsers, dashboards and logs treated as sensitive, access tokens held to the same standard as your database credentials.
- Never build cache keys from browser-provided user ids — only from the server-derived `userId` the manager passes in.
- Never cache metadata/list responses through this mechanism; it exists solely for `getById` credential records.

Further reading: [security guide](../security.md) · [API reference](../reference/api.md#cachedstorageoptions) · [threat model](../development/threat-model.md)
