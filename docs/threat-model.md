# Threat Model

## Protects Against

- Metadata table compromise exposing plaintext credentials.
- Accidental credential serialization through `JSON.stringify` or object-level coercion.
- Direct browser role access to metadata or credential RPC functions.
- Stale Vault secrets after metadata deletion.

## Does Not Protect Against

- Compromised application server processes.
- Compromised Supabase secret keys.
- Supabase infrastructure or root-key compromise.
- Compromised Redis or other app-owned credential cache entries.
- Malicious dependencies running inside trusted server code.
- Provider-side billing, abuse, or rate-limit failures after a key is used.
- Immediate global revocation when stale credential cache entries survive until TTL expiry.

## Operational Guidance

- Keep Supabase secret keys out of browser bundles.
- Retrieve user credentials as late as possible.
- Do not put returned credential objects into logger context or framework return values.
- Treat Redis-style credential caches as trusted secret infrastructure because values contain plaintext API keys.
- Keep credential caches server-only and derive cache keys from trusted server-side identity plus `keyId`, never browser-provided user ids.
- Use short cache TTLs and understand that cache invalidation is not transactional with durable storage.
- Offer users rotation and deletion flows.
- Encourage provider-side spending caps and usage alerts.
