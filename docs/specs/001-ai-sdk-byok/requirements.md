# Requirements: ai-sdk-byok v0.1

## Status

Draft, derived from `ai_sdk_byok_design.md`.

## Functional Requirements

- The package exposes `createByokManager` from `ai-sdk-byok`.
- The package exposes `supabaseAdapter` from `ai-sdk-byok/supabase`.
- The manager supports `keys.save`, `keys.list`, `keys.get`, and `keys.delete`.
- `save` stores or rotates one single-field API-key credential for `(userId, provider, label)`.
- `list` returns metadata only and orders by `updatedAt` descending, then `createdAt` descending.
- `get` returns `null` for missing credentials and proxy-wrapped `{ apiKey }` for existing credentials.
- `delete` is idempotent at the public API layer.
- Provider names are opaque application-defined strings.
- Omitted labels normalize to `default`.
- `keyHint` is derived as the final up-to-four characters of the API key.

## Validation Requirements

- `userId` is a non-empty string up to 256 characters.
- `provider` is a non-empty string up to 128 characters.
- `label` is a non-empty string up to 128 characters after omission normalization.
- `credentials` is exactly `{ apiKey: string }` with no extra fields.
- `apiKey` is non-empty and no longer than 8192 characters.
- Validated string fields (`userId`, `provider`, `label`, `keyId`, `apiKey`) must not contain ASCII control characters (U+0000–U+001F, U+007F).
- Validation failures throw `AiSdkByokValidationError` before storage adapter calls.

## Security Requirements

- Public metadata never exposes `vault_secret_id`.
- Plaintext credentials are returned only by explicit `get` calls.
- Proxy-wrapped credentials block `JSON.stringify` and object-level string coercion.
- Node inspect paths return a redacted representation without importing `node:util` at package top level.
- Adapter errors never include plaintext credentials or serialized credential input.
- Supabase credential RPC functions are service-role-only.
- Supabase security-definer functions set `search_path = ''` and fully qualify database objects.

## Runtime Requirements

- Package entrypoints support Node.js 22+.
- Core and Supabase package entrypoints remain Edge-compatible ESM.

## Out of Scope

- Multi-field credentials.
- Provider API validation.
- OAuth or PKCE flows.
- AI SDK middleware or model wrappers.
- React UI components.
- Non-Supabase adapters.
- App-side cryptography.
