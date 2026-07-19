# Architecture

`ai-sdk-byok` separates credential lifecycle policy from storage implementation.

## Core Entrypoint

The core manager owns:

- input validation;
- label normalization;
- key-hint derivation;
- metadata-only public write responses;
- proxy wrapping of returned plaintext credentials;
- optional cache composition through `cachedStorage`.

Adapters receive normalized inputs and return typed metadata or credentials.

`keys.getById({ userId, keyId })` returns a credential record containing safe metadata plus proxy-wrapped credentials. This lets server routes select the AI SDK provider from stored metadata after a browser submits only a metadata id.

## Supabase Entrypoint

The Supabase adapter uses a server-side Supabase client initialized with a secret key for credential-touching RPC calls and metadata listing. Supabase secret keys are the current replacement for legacy `service_role` API keys. Supabase Vault performs encryption and decryption inside the database boundary.

Supabase is the first concrete durable adapter for key-id retrieval. The optional cache layer is adapter-agnostic and does not depend on Supabase RPC names, Vault secret ids, tables, or migrations.

## Cloudflare Adapter

`@ai-sdk-byok/cloudflare` targets apps running on Cloudflare Workers. `d1Adapter` implements the core storage contract on a D1 binding; `kvCredentialCache` implements the credential-record cache contract on a KV binding. Both seal credentials with AES-256-GCM (WebCrypto) before writing; the 32-byte master key arrives via a Worker secret string or an async getter (Secrets Store). The sealed format is versioned (`v1.`) so key rotation can be introduced without data migration. `save` is a single-statement upsert with `RETURNING`; `list` never projects the ciphertext column. The KV cache hashes `userId`/`keyId` into fixed-length keys and layers a logical `expiresAt` (sealed, authoritative) over KV's physical `expirationTtl` (floored at 60 s).

## Drizzle SQL Adapter

`@ai-sdk-byok/drizzle` targets applications that already own a Drizzle PostgreSQL database. Encryption and decryption happen in trusted application code with AES-256-GCM. SQL sees metadata plus base64url ciphertext, a base64url nonce, and the non-secret encryption-key version; it never sees the master key or plaintext credentials.

The master key is a 32-byte base64 value. Every write uses a new random 12-byte nonce, and authenticated data binds the ciphertext to `(userId, provider)`. Key rotation configures one `current` key for all new writes and optional `previous` keys for reading existing rows by version. Re-encryption of old rows may be deferred while the previous keys remain configured.

## Optional Credential Cache

`cachedStorage` wraps a storage adapter below the core manager. It caches internal serializable credential records for `getById`, then the manager proxy-wraps credentials before returning public records.

Cache entries are scoped by trusted server-side `userId` plus `keyId`; apps may hash that tuple before storing Redis keys. Cache misses fall back to durable storage and may populate the cache. `save`/rotation invalidates the returned metadata id, and `delete` invalidates before and after durable deletion. TTL is required and should be short, typically 30–120 seconds. Metadata/list caching is intentionally out of scope.

## Database Boundary

The Supabase migration creates `public.ai_sdk_byok_keys` for metadata and stores plaintext credentials only inside Vault secrets. Wrapper functions use `SECURITY DEFINER`, set `search_path = ''`, and grant execution only to `service_role`.

The Drizzle migration creates `ai_sdk_byok_keys` for metadata and encrypted fields. The application-side encryption boundary keeps the master key and plaintext credentials outside SQL; the database stores only metadata, ciphertext, nonce, and key version.

## Runtime Boundary

The package entrypoints avoid Node-only modules so they can run in Edge-compatible server runtimes. Tests may import Node test utilities, but package source must not.
