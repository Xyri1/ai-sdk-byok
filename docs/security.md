# Security Guide

What `ai-sdk-byok` guarantees, what your integration must uphold, and what nothing here protects against. The formal analysis lives in the [threat model](development/threat-model.md); this page is the working version for integrators.

## The division of responsibility

The library guarantees, across all adapters:

- `save` and `list` return metadata only — plaintext credentials never appear in their results, and storage-secret identifiers (like Vault secret IDs) are never exposed.
- Plaintext credentials are returned **only** by explicit `keys.get` / `keys.getById` calls.
- Returned credentials are proxy-wrapped: `JSON.stringify` and string coercion throw `AiSdkByokSerializationError` instead of leaking the key; Node's `console.log` prints `[ApiKeyCredentials redacted]`.
- Adapter error messages never contain credential plaintext, ciphertext, or key material.
- At rest, credentials are never plaintext: Supabase keeps them inside Vault; the Cloudflare and Drizzle adapters seal them with AES-256-GCM before storage, with ciphertext AAD-bound to its slot so blobs cannot be replayed across rows.

Your integration must uphold the rest. The guarantees above are bypassable by server code that mishandles the one legitimate access path (`credentials.apiKey` is a plain string once read).

## Rules your integration must follow

**Everything server-side.** The manager, adapters, and their secrets exist only in trusted server code. Nothing from these packages belongs in browser bundles.

**Derive `userId` from your session, never from the browser.** The browser may choose a key `id` from a metadata list; it must never supply the `userId` that scopes any call. Likewise, select the provider from stored `record.provider`, not from a browser-sent value.

**Retrieve late, drop fast.** Call `get`/`getById` inside the handler that constructs the AI SDK provider, pass `record.credentials.apiKey` directly to the provider factory, and let everything fall out of scope. Do not stash credentials in module state, request context, or framework return values.

**Never log or serialize credentials.** Do not put credential records into logger context, error reports, analytics, or route responses. The proxy makes whole-object serialization throw, but `apiKey` read into a string is on you.

**Keep list responses metadata-only.** `keys.list()` output is safe for browsers by construction — keep it that way; don't join it with credential data in your own code.

## Secret material per adapter

| Adapter | Secret | Rules |
| --- | --- | --- |
| Supabase | Project **secret key** (`sb_secret_…`) | Server-side env only; never in browser bundles or `NEXT_PUBLIC_`-style vars. The credential RPCs are service-role-only — never widen their grants. Rotate via the Supabase dashboard if leaked. |
| Cloudflare | 32-byte master key | Worker secret or Secrets Store binding only — never in `wrangler.jsonc` vars, code, or logs. Generate with `openssl rand -base64 32`. |
| Drizzle | 32-byte base64 master key | Server-side secrets only; never stored in SQL, never logged. Generate with `openssl rand -base64 32`. Supports versioned rotation (`current` + `previous`). |

**Master-key loss is unrecoverable by design** (Cloudflare and Drizzle): without the key, stored ciphertext is noise, and users must re-enter their API keys. Escrow the key in your team's secret manager.

**Master-key leak:** if a master key leaks and the matching ciphertext may also have been exposed (dump, backup, replica), treat those rows as compromised — have affected users rotate their provider API keys. Re-encrypting under a new key does not retroactively protect data that was already decryptable. Full rotation workflow: [Drizzle guide](guides/drizzle.md#8-operational-notes); for Cloudflare, see [its operational notes](guides/cloudflare.md#8-operational-notes).

## If you enable caching

`cachedStorage` cache entries contain plaintext credential records. The cache backend is therefore trusted secret infrastructure: server-only, with its dashboards, logs, and access tokens treated as sensitive. Keep TTLs short (30–120 s) — the TTL is your revocation window, since invalidation is best-effort and not transactional with durable storage. Details: [caching guide](guides/caching.md).

## What this library does not protect against

Be honest with yourself about the boundary:

- **A compromised application server.** The server legitimately holds adapter secrets and reads plaintext credentials; an attacker with server code execution has both. This includes malicious dependencies running in trusted server code.
- **Leaked adapter secrets**: a leaked Supabase secret key, or a leaked master key combined with ciphertext access.
- **Provider-side consequences** after a key is used: billing, abuse, rate limits. Encourage users to set provider spending caps and alerts, and give them visible rotation and deletion flows.
- **Instant global revocation** when caching is enabled — stale entries survive until TTL expiry (plus KV cross-region propagation).
- **Infrastructure-level compromise** of Supabase (Vault root keys) or a Cloudflare account with dashboard access to secrets.

What it *does* protect against — database-only compromise (dumps, backups, replicas, a stolen D1/KV snapshot) without the corresponding secret, accidental serialization of credentials, and browser-role access to credential data — is exactly the class of mistakes and leaks that BYOK apps most commonly make. Details per adapter: [threat model](development/threat-model.md).
