# API Reference

Complete reference for the public exports of `ai-sdk-byok`, `@ai-sdk-byok/supabase`, `@ai-sdk-byok/cloudflare`, and `@ai-sdk-byok/drizzle`. All packages are ESM-only and fully typed.

- [`createByokManager`](#createbyokmanageroptions) and the [`keys.*` methods](#manager-methods)
- [Shared types](#shared-types) · [Validation rules](#validation-rules) · [Credential proxy behavior](#credential-proxy-behavior) · [Errors](#errors)
- [`cachedStorage`](#cachedstorageoptions) and the cache contract
- Adapters: [`supabaseAdapter`](#supabaseadapteroptions) · [`d1Adapter`](#d1adapteroptions) · [`kvCredentialCache`](#kvcredentialcacheoptions) · [`drizzleAdapter`](#drizzleadapteroptions)
- [Writing a custom storage adapter](#byokstorageadapter)

## `createByokManager(options)`

From `ai-sdk-byok`. Creates the BYOK manager — the only object application code should call.

```ts
import { createByokManager } from 'ai-sdk-byok';

const byok = createByokManager({ storage });
```

| Option | Type | Description |
| --- | --- | --- |
| `storage` | `ByokStorageAdapter` | Required. A storage adapter from one of the adapter packages, optionally wrapped in `cachedStorage`. |

Returns a `ByokManager`: `{ keys: { save, list, get, getById, delete } }`.

The manager validates and normalizes all inputs before the adapter sees them (see [validation rules](#validation-rules)), derives `keyHint`, and proxy-wraps returned credentials.

### Manager methods

#### `keys.save(input)`

Stores a credential, or rotates it in place when `(userId, provider, label)` already exists.

```ts
const metadata = await byok.keys.save({
  userId: 'user_123',
  provider: 'openai',
  credentials: { apiKey: 'sk-…' },
  label: 'work',            // optional; defaults to 'default'
});
```

Input `SaveKeyInput`: `{ userId, provider, credentials: { apiKey }, label? }`.
Returns `Promise<KeyMetadata>` — metadata only, never the credential.
Throws `AiSdkByokValidationError` on invalid input, `AiSdkByokAdapterError` on storage failure.

#### `keys.list(input)`

Lists all key metadata for a user, ordered by `updatedAt` descending, then `createdAt` descending.

```ts
const keys = await byok.keys.list({ userId: 'user_123' });
```

Input `ListKeysInput`: `{ userId }`.
Returns `Promise<KeyMetadata[]>` — safe to send to browsers; never contains credentials or storage-secret identifiers.

#### `keys.get(input)`

Returns the credential for `(userId, provider, label)`, or `null` if none exists.

```ts
const credentials = await byok.keys.get({
  userId: 'user_123',
  provider: 'openai',
  label: 'work',            // optional; defaults to 'default'
});
// credentials?.apiKey
```

Input `GetKeyInput`: `{ userId, provider, label? }`.
Returns `Promise<ApiKeyCredentials | null>` — proxy-wrapped (see [credential proxy behavior](#credential-proxy-behavior)).

#### `keys.getById(input)`

Returns metadata **plus** the credential for a key selected by id, or `null` if the id does not exist for that user. This is the preferred retrieval method when a browser picked a key from `keys.list()`: the browser sends only the metadata `id`; `userId` comes from server-side auth; the lookup checks both.

```ts
const record = await byok.keys.getById({ userId: 'user_123', keyId });

if (record) {
  record.provider;                 // use for provider selection
  record.credentials.apiKey;       // pass to the AI SDK provider factory
}
```

Input `GetKeyByIdInput`: `{ userId, keyId }`.
Returns `Promise<KeyCredentialRecord | null>` — metadata fields plus proxy-wrapped `credentials`.

#### `keys.delete(input)`

Deletes a key by `userId` and `keyId`. Idempotent: deleting a nonexistent key resolves normally.

```ts
await byok.keys.delete({ userId: 'user_123', keyId });
```

Input `DeleteKeyInput`: `{ userId, keyId }`.
Returns `Promise<void>`.

## Shared types

All exported from `ai-sdk-byok`.

```ts
interface ApiKeyCredentials {
  apiKey: string;
}

interface KeyMetadata {
  id: string;          // opaque key id (UUID); safe for browsers
  userId: string;
  provider: string;    // your app-defined provider name
  label: string;       // 'default' when omitted at save time
  keyHint: string;     // last up-to-4 characters of the API key
  createdAt: string;   // ISO 8601
  updatedAt: string;   // ISO 8601
}

interface KeyCredentialRecord extends KeyMetadata {
  credentials: ApiKeyCredentials;   // proxy-wrapped
}
```

Input types: `SaveKeyInput`, `ListKeysInput`, `GetKeyInput`, `GetKeyByIdInput`, `DeleteKeyInput` — shapes shown with each method above.

## Validation rules

The manager validates every call before the storage adapter runs. Violations throw `AiSdkByokValidationError`.

| Field | Rule |
| --- | --- |
| `userId` | Non-empty string, ≤ 256 characters |
| `provider` | Non-empty string, ≤ 128 characters |
| `label` | Non-empty string, ≤ 128 characters; omitted → `'default'` |
| `keyId` | Non-empty string, ≤ 128 characters |
| `credentials` | Exactly `{ apiKey: string }` — no extra fields |
| `apiKey` | Non-empty string, ≤ 8192 characters |

All validated strings additionally reject ASCII control characters (U+0000–U+001F, U+007F).

## Credential proxy behavior

Credentials returned by `get`/`getById` are wrapped so accidental serialization fails loudly:

- `JSON.stringify(credentials)` → throws `AiSdkByokSerializationError`
- String coercion (`` `${credentials}` ``, `credentials + ''`) → throws `AiSdkByokSerializationError`
- `console.log(credentials)` in Node → prints `[ApiKeyCredentials redacted]`
- `credentials.apiKey` → the plaintext key (this is the one intended access path)
- The object is frozen; properties cannot be added or changed.

Note the protection is object-level: once you read `credentials.apiKey` into a plain string, that string is unprotected — pass it straight into a provider factory and let it fall out of scope.

## Errors

All exported from `ai-sdk-byok`; all extend `AiSdkByokError extends Error`.

| Class | Thrown when |
| --- | --- |
| `AiSdkByokValidationError` | Input fails [validation rules](#validation-rules); adapter options are invalid (bad dialect, malformed encryption key). |
| `AiSdkByokAdapterError` | A storage or cache backend operation fails. Messages name the operation (e.g. `"Supabase BYOK adapter failed during save"`) and never contain credential material; the underlying error is attached as `cause` where available. |
| `AiSdkByokSerializationError` | Something attempted to serialize or coerce a protected credential object. |

```ts
import { AiSdkByokError, AiSdkByokValidationError } from 'ai-sdk-byok';

try {
  await byok.keys.save(input);
} catch (error) {
  if (error instanceof AiSdkByokValidationError) {
    // 4xx — bad input
  } else if (error instanceof AiSdkByokError) {
    // 5xx — storage failure
  }
}
```

## `cachedStorage(options)`

From `ai-sdk-byok`. Wraps a storage adapter with a read-path cache for `getById`. See the [caching guide](../guides/caching.md) for semantics, TTL guidance, and safety rules.

```ts
import { cachedStorage } from 'ai-sdk-byok';

const storage = cachedStorage({ storage: durableAdapter, cache, ttlMs: 60_000 });
```

| Option | Type | Description |
| --- | --- | --- |
| `storage` | `ByokStorageAdapter` | Required. The durable adapter to wrap. |
| `cache` | `CredentialRecordCache` | Required. The cache backend. |
| `ttlMs` | `number` | Required. Positive finite TTL in milliseconds; throws `AiSdkByokValidationError` otherwise. |

Returns a `ByokStorageAdapter` (pass it to `createByokManager`). Only `getById` is cached; `save` and `delete` invalidate best-effort; cache read failures fall back to durable storage.

### `CredentialRecordCache`

The contract a cache backend implements:

```ts
interface CredentialRecordCache {
  get(input: GetStorageByIdInput): Promise<StoredKeyCredentialRecord | null>;
  set(
    input: GetStorageByIdInput,
    record: StoredKeyCredentialRecord,
    options: CredentialRecordCacheSetOptions,   // { ttlMs: number }
  ): Promise<void>;
  delete(input: GetStorageByIdInput): Promise<void>;
}
```

`GetStorageByIdInput` is `{ userId, keyId }`; `StoredKeyCredentialRecord` is metadata plus **unwrapped** plaintext credentials (the manager applies the proxy after the cache layer). Implementation rules are in the [caching guide](../guides/caching.md#implementing-a-cache-backend).

## `supabaseAdapter(options)`

From `@ai-sdk-byok/supabase`. Storage adapter backed by Supabase Vault and the package's service-role-only RPC functions. Requires the [package migrations](../guides/supabase.md#3-apply-the-migrations).

```ts
import { supabaseAdapter } from '@ai-sdk-byok/supabase';

const storage = supabaseAdapter({ client: supabaseAdmin });
```

| Option | Type | Description |
| --- | --- | --- |
| `client` | Supabase client | Required. Created with `createClient(url, secretKey)` using a server-side **secret key**. Never a browser `anon`/`publishable` client. |

Peer dependency: `@supabase/supabase-js`. Full setup: [Supabase guide](../guides/supabase.md).

## `d1Adapter(options)`

From `@ai-sdk-byok/cloudflare`. Storage adapter on a Cloudflare D1 binding. Credentials are sealed with AES-256-GCM before insert; requires the [package migration](../guides/cloudflare.md#3-create-resources-and-apply-the-migration).

```ts
import { d1Adapter } from '@ai-sdk-byok/cloudflare';

const storage = d1Adapter({ database: env.DB, encryptionKey: env.BYOK_MASTER_KEY });
```

| Option | Type | Description |
| --- | --- | --- |
| `database` | `D1Database` binding | Required. |
| `encryptionKey` | `EncryptionKeyInput` | Required. Base64 string decoding to exactly 32 bytes, or an async getter `() => string \| Promise<string>` (for Secrets Store). Invalid keys throw `AiSdkByokValidationError`. |

`EncryptionKeyInput` is exported as a type. Full setup: [Cloudflare guide](../guides/cloudflare.md).

## `kvCredentialCache(options)`

From `@ai-sdk-byok/cloudflare`. A `CredentialRecordCache` backend on a Workers KV binding, for use with `cachedStorage`. Cached records are sealed with AES-256-GCM; cache keys are SHA-256 hashes of `(userId, keyId)`.

```ts
import { kvCredentialCache } from '@ai-sdk-byok/cloudflare';

const cache = kvCredentialCache({ namespace: env.BYOK_CACHE, encryptionKey: env.BYOK_MASTER_KEY });
```

| Option | Type | Description |
| --- | --- | --- |
| `namespace` | `KVNamespace` binding | Required. |
| `encryptionKey` | `EncryptionKeyInput` | Required. Same format as `d1Adapter`; typically the same master key. |
| `keyPrefix` | `string` | Optional. Prefix for KV keys. Default `'ai-sdk-byok:'`. |

KV's physical `expirationTtl` is floored at 60 seconds; the sealed payload embeds a logical expiry honoring your exact `ttlMs`, which is authoritative.

## `drizzleAdapter(options)`

From `@ai-sdk-byok/drizzle`. Storage adapter for a caller-owned Drizzle PostgreSQL database, encrypting credentials app-side with AES-256-GCM. Requires the [package migration or a Drizzle Kit equivalent](../guides/drizzle.md#3-apply-the-migration).

```ts
import { drizzleAdapter } from '@ai-sdk-byok/drizzle';

const storage = drizzleAdapter({
  db,
  dialect: 'postgres',
  encryption: {
    current: { version: 'v1', key: process.env.AI_SDK_BYOK_MASTER_KEY! },
  },
});
```

| Option | Type | Description |
| --- | --- | --- |
| `db` | Drizzle `PgDatabase` | Required. Your app's configured Drizzle Postgres instance; the adapter never creates connections. |
| `dialect` | `'postgres'` | Required. Any other value throws `AiSdkByokValidationError`. |
| `encryption` | `EncryptionConfig` | Required. See below. |

### `EncryptionConfig`

```ts
type EncryptionKey = {
  version: string;                        // stored (non-secret) alongside each row
  key: string | Uint8Array | CryptoKey;   // base64 string decoding to 32 bytes, raw 32 bytes, or an AES-GCM CryptoKey
};

type EncryptionConfig = {
  current: EncryptionKey;      // encrypts all new writes
  previous?: EncryptionKey[];  // read-only; decrypt rows carrying their version
};
```

Rotation workflow: [Drizzle guide, operational notes](../guides/drizzle.md#8-operational-notes).

### `aiSdkByokKeys`

The Drizzle table schema for `ai_sdk_byok_keys`, exported for Drizzle Kit users who generate migrations instead of applying the shipped SQL, and for building app-level queries (e.g. admin counts). Do not write credential columns through it directly — always go through the manager.

```ts
import { aiSdkByokKeys } from '@ai-sdk-byok/drizzle';
```

The package also exports lower-level crypto utilities (`createKeyring`, `credentialAad`, and the `EncryptedPayload` type) used internally by the adapter; typical integrations never need them.

## `ByokStorageAdapter`

The contract adapter packages implement — also the extension point for a custom backend. Adapters receive input already validated and normalized by the manager (label defaulted, `keyHint` derived).

```ts
interface ByokStorageAdapter {
  save(input: SaveStorageInput): Promise<KeyMetadata>;                       // upsert on (userId, provider, label)
  list(input: ListStorageInput): Promise<KeyMetadata[]>;                     // updatedAt desc, createdAt desc
  get(input: GetStorageInput): Promise<ApiKeyCredentials | null>;
  getById(input: GetStorageByIdInput): Promise<StoredKeyCredentialRecord | null>;
  delete(input: DeleteStorageInput): Promise<void>;                          // no-op when absent
}
```

Custom adapters must uphold the [security invariants](../security.md): metadata-only `save`/`list` results, no plaintext or key material in error messages, and deletion that removes the underlying secret.
