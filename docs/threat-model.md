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
- Malicious dependencies running inside trusted server code.
- Provider-side billing, abuse, or rate-limit failures after a key is used.

## Operational Guidance

- Keep Supabase secret keys out of browser bundles.
- Retrieve user credentials as late as possible.
- Do not put returned credential objects into logger context or framework return values.
- Offer users rotation and deletion flows.
- Encourage provider-side spending caps and usage alerts.
