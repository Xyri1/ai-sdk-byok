# Threat Model

## Protects Against

- Metadata table compromise exposing plaintext credentials.
- Accidental credential serialization through `JSON.stringify` or object-level coercion.
- Direct browser role access to metadata or credential RPC functions.
- Stale Vault secrets after metadata deletion.
- Cloudflare D1 or KV data compromise without the Worker master key (values are AES-256-GCM ciphertext).
- Sealed-credential replay across storage slots (ciphertext is AAD-bound to `userId`/`provider`/`label` in D1 and `userId`/`keyId` in KV).

## Does Not Protect Against

- Compromised application server processes.
- Compromised Supabase secret keys.
- Supabase infrastructure or root-key compromise.
- Compromised Redis or other app-owned credential cache entries.
- Malicious dependencies running inside trusted server code.
- Provider-side billing, abuse, or rate-limit failures after a key is used.
- Immediate global revocation when stale credential cache entries survive until TTL expiry.
- Simultaneous compromise of the Worker master key and D1/KV data.
- Compromised Cloudflare account or dashboard access combined with a leaked master key.
- Immediate global revocation across KV regions; deleted or rotated cache entries can be served elsewhere until propagation plus TTL expiry.

## Operational Guidance

- Keep Supabase secret keys out of browser bundles.
- Retrieve user credentials as late as possible.
- Do not put returned credential objects into logger context or framework return values.
- Treat Redis-style credential caches as trusted secret infrastructure because values contain plaintext API keys.
- Keep credential caches server-only and derive cache keys from trusted server-side identity plus `keyId`, never browser-provided user ids.
- Use short cache TTLs and understand that cache invalidation is not transactional with durable storage.
- Offer users rotation and deletion flows.
- Encourage provider-side spending caps and usage alerts.
- Generate the Cloudflare master key with a CSPRNG (for example `openssl rand -base64 32`) and store it only in Worker secrets or Secrets Store.
- Losing the master key makes stored credentials unrecoverable by design; users re-enter their API keys.
- Keep KV cache TTLs short; KV invalidation is eventually consistent across regions.
