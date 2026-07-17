# Cloudflare Adapter (`@ai-sdk-byok/cloudflare`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@ai-sdk-byok/cloudflare` — a D1-backed `ByokStorageAdapter` plus a Workers-KV-backed `CredentialRecordCache`, both always-encrypted with AES-256-GCM sealed credentials.

**Architecture:** New workspace package `packages/cloudflare` mirroring `packages/supabase` conventions. An internal `crypto.ts` sealer (AES-256-GCM via WebCrypto, versioned `v1.` format, AAD slot-binding) is shared by `d1Adapter` (single-statement upsert with `RETURNING`, metadata-only projections) and `kvCredentialCache` (hashed keys, two-layer TTL). Tests run real SQL against `better-sqlite3` behind a minimal fake D1 binding.

**Tech Stack:** TypeScript (strict, `verbatimModuleSyntax`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), tsup (ESM, platform neutral), Vitest, WebCrypto (`crypto.subtle` — global in Workers and Node 22+), better-sqlite3 (dev-only).

**Spec:** `docs/2026-07-17-cloudflare-adapter-design.md` (approved). Read it before starting.

## Global Constraints

- Package source must avoid Node-only top-level imports (Edge-compatible ESM); tests may use Node utilities (`AGENTS.md`).
- Runtime support: Node.js 22 or newer; build output is ESM only.
- `save`/`list` must never return plaintext credentials; adapter errors must not include plaintext credentials, key material, ciphertext, or serialized credential input.
- Validation limits (already enforced by core before adapter calls, re-enforced by SQL CHECKs): `userId` ≤ 256 chars, `provider` ≤ 128, `label` ≤ 128, `key_hint` ≤ 4, `apiKey` ≤ 8192.
- Master key: base64-encoded, exactly 32 bytes after decoding. Sealed format: `v1.<base64url(iv)>.<base64url(ciphertext||tag)>`, AES-256-GCM, 96-bit random IV.
- AAD: D1 rows use `userId\0provider\0label`; KV entries use `userId\0keyId`.
- KV `expirationTtl` physical floor is 60 seconds; logical expiry (`expiresAt` inside the sealed payload) is authoritative.
- List ordering: `updated_at DESC, created_at DESC` (ISO-8601 UTC strings).
- Conventional Commits, lowercase types. Spec/doc updates land in the same change as the behavior they govern.
- `package-lock.json` already has uncommitted changes in the working tree; include it in the first commit that touches dependencies.

---

### Task 1: Feature spec `specs/003-cloudflare-adapter/` + AGENTS.md scope change

This is the product-decision commit required by the repo's SDD workflow — no implementation code.

**Files:**
- Create: `specs/003-cloudflare-adapter/requirements.md`
- Create: `specs/003-cloudflare-adapter/decisions.md`
- Create: `specs/003-cloudflare-adapter/tasks.md`
- Create: `specs/003-cloudflare-adapter/plan.md`
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes: `docs/2026-07-17-cloudflare-adapter-design.md` (approved design).
- Produces: the governing spec later tasks reference; updated `AGENTS.md` scope.

- [ ] **Step 1: Write `specs/003-cloudflare-adapter/requirements.md`**

```markdown
# Requirements: Cloudflare Adapter (D1 Storage + KV Credential Cache)

## Status

Accepted.

## Problem

Apps built on the AI SDK and hosted on Cloudflare Workers cannot use `ai-sdk-byok` today: the only storage adapter targets Supabase Vault, and Cloudflare offers no managed per-user secret store (Worker Secrets and Secrets Store hold deploy-time configuration secrets only; D1/KV at-rest encryption is transparent to anyone with data access).

## Goals

- A `ByokStorageAdapter` backed by Cloudflare D1, consumed via a Workers binding.
- A `CredentialRecordCache` backed by Workers KV, plugging into the existing `cachedStorage()` wrapper.
- Credentials always encrypted at the application layer before touching D1 or KV.
- Preserve the package-wide invariant: storage compromise without the master key does not expose plaintext credentials.

## Non-Goals

- No plaintext storage mode and no pluggable crypto surface.
- No Cloudflare HTTP API access from non-Workers runtimes.
- No sharded/multi-database D1 routing (documented capacity path only).
- No master-key rotation tooling (the `v1.` format prefix reserves the seam).
- No Durable Objects or R2 backends; no example Worker app in v1.

## Functional Requirements

- `@ai-sdk-byok/cloudflare` exposes `d1Adapter(options)` returning a `ByokStorageAdapter` and `kvCredentialCache(options)` returning a `CredentialRecordCache`.
- `d1Adapter` options: `database` (D1 binding, structurally typed), `encryptionKey` (base64 32-byte string, or sync/async getter returning one).
- `kvCredentialCache` options: `namespace` (KV binding, structurally typed), `encryptionKey` (same contract), optional `keyPrefix` (default `ai-sdk-byok:`).
- `save` is a single atomic upsert on `(user_id, provider, label)`; rotation preserves `id` and `created_at`.
- `list` orders by `updated_at DESC, created_at DESC` and never projects the ciphertext column.
- `delete` is idempotent by `(id, user_id)`.
- Timestamps are ISO-8601 UTC strings generated by the adapter; ids are adapter-generated UUIDs.
- KV cache keys are `keyPrefix + sha256hex(userId + '\0' + keyId)`.
- KV physical TTL is `max(60, ceil(ttlMs / 1000))`; logical expiry uses an `expiresAt` timestamp sealed inside the value and is authoritative on read.

## Security Requirements

- AES-256-GCM via WebCrypto; fresh random 96-bit IV per write; key imported non-extractable.
- Sealed format `v1.<base64url(iv)>.<base64url(ciphertext||tag)>`.
- AAD binds ciphertext to its slot: `userId\0provider\0label` (D1), `userId\0keyId` (KV). Ciphertext copied to another slot must fail decryption.
- `encryptionKey` must decode to exactly 32 bytes; string form validated at construction, getter form on first use; error messages never echo key material.
- Cache integrity failures (wrong key, tampered, malformed) are treated as a miss with best-effort deletion of the bad entry.
- Adapter errors never contain plaintext credentials, key material, ciphertext, or serialized credential input.

## Runtime Requirements

- Package source is Edge-compatible ESM: WebCrypto, `crypto.randomUUID`, `crypto.getRandomValues` only — no Node-only top-level imports.
- Works on Node.js 22+ (tests) and Cloudflare Workers (production).
```

- [ ] **Step 2: Write `specs/003-cloudflare-adapter/decisions.md`**

```markdown
# Decisions: Cloudflare Adapter

- **D-301 Always-encrypted, no plaintext mode.** Cloudflare has no managed per-user secret store or KMS; the platform-idiomatic pattern is ciphertext in D1/KV with a master key in a Worker secret and AES-GCM via `crypto.subtle`. A plaintext or pluggable mode would fragment the package's security story. (2026-07-17)
- **D-302 One package, two exports.** `@ai-sdk-byok/cloudflare` ships `d1Adapter` and `kvCredentialCache` together so Workers integrators get the complete composed setup on day one. (2026-07-17)
- **D-303 Bindings only.** The adapter consumes Workers bindings (`env.DB`, KV namespace), not the Cloudflare HTTP API. Structural typing; `@cloudflare/workers-types` is not a dependency. (2026-07-17)
- **D-304 Scope change to AGENTS.md.** "Non-Supabase storage adapters" leaves Out Of Scope; "Application-side cryptography" is narrowed to exclude this package's sealed-credential scheme. (2026-07-17)
- **D-305 Capacity ceiling documented, sharding deferred.** D1's 10 GB per-database cap supports roughly 8M stored keys; the schema is shard-friendly (all queries keyed by `user_id`, app-generated UUIDs) so a future sharded adapter needs no schema change. (2026-07-17)
- **D-306 Losing the master key is acceptable, not catastrophic.** Users re-enter API keys; provider keys are re-enterable by nature. Documented in the threat model. (2026-07-17)
- **D-307 KV eventual consistency documented, not solved.** A deleted/rotated cache entry may be readable in other regions until propagation (~60s) plus remaining TTL; entries remain ciphertext at rest. Guidance: keep `ttlMs` short. (2026-07-17)
```

- [ ] **Step 3: Write `specs/003-cloudflare-adapter/tasks.md`**

```markdown
# Tasks: Cloudflare Adapter

Implementation plan: `docs/plans/2026-07-17-cloudflare-adapter.md`.

- [ ] Feature spec and AGENTS.md scope change
- [ ] Package scaffold and sealed-credential crypto module
- [ ] D1 migration and SQLite-backed test shim
- [ ] `d1Adapter` storage adapter
- [ ] `kvCredentialCache` credential cache
- [ ] End-to-end composition and security-invariant tests
- [ ] Documentation: READMEs, threat model, architecture
```

- [ ] **Step 4: Write `specs/003-cloudflare-adapter/plan.md`**

```markdown
# Plan: Cloudflare Adapter

The approved design is `docs/2026-07-17-cloudflare-adapter-design.md`; the step-by-step implementation plan is `docs/plans/2026-07-17-cloudflare-adapter.md`. This spec directory holds the governing requirements and decisions; delivery status is tracked in `tasks.md`.
```

- [ ] **Step 5: Update `AGENTS.md`**

In the **Scope** section, append to the bullet list:

```markdown
- a Cloudflare adapter published as `@ai-sdk-byok/cloudflare` (D1 storage adapter and Workers KV credential cache with always-encrypted sealed credentials);
```

In **Source Of Truth**, change the sentence "treat `specs/001-ai-sdk-byok/` as the current detailed feature spec" to:

```markdown
treat `specs/001-ai-sdk-byok/` as the baseline feature spec, with `specs/002-key-id-redis-cache/` and `specs/003-cloudflare-adapter/` layering later accepted features.
```

In **Repository Layout**, after the `packages/supabase` bullet, add:

```markdown
- `packages/cloudflare`: Cloudflare D1 storage adapter, Workers KV credential cache, sealed-credential crypto, tests, package README, and shipped D1 migrations.
```

In **Public API Requirements**, after the `@ai-sdk-byok/supabase` line, add:

```markdown
`@ai-sdk-byok/cloudflare` exposes `d1Adapter(options)` and `kvCredentialCache(options)`.
```

In **Security Invariants**, append:

```markdown
- Cloudflare adapter credentials must be sealed with AES-256-GCM before reaching D1 or KV; plaintext and ciphertext must never appear in metadata output or error messages.
- The Cloudflare master encryption key must decode to exactly 32 bytes, must live only in Worker secrets or Secrets Store bindings, and must never be logged or echoed in errors.
```

In **Out Of Scope**, delete the line `- Non-Supabase storage adapters.` and replace `- Application-side cryptography.` with:

```markdown
- Application-side cryptography beyond the sealed-credential scheme owned by `@ai-sdk-byok/cloudflare`.
```

- [ ] **Step 6: Verify docs render and nothing else changed**

Run: `git diff --stat AGENTS.md && ls specs/003-cloudflare-adapter/`
Expected: only AGENTS.md modified; four new files listed.

- [ ] **Step 7: Commit**

```bash
git add AGENTS.md specs/003-cloudflare-adapter/
git commit -m "docs: add cloudflare adapter spec and expand scope"
```

---

### Task 2: Package scaffold + sealed-credential crypto module

**Files:**
- Create: `packages/cloudflare/package.json`
- Create: `packages/cloudflare/src/index.ts`
- Create: `packages/cloudflare/src/crypto.ts`
- Create: `packages/cloudflare/LICENSE` (copy of root `LICENSE`)
- Modify: `tsup.config.ts`
- Modify: `tsconfig.json` (add path mapping)
- Test: `packages/cloudflare/src/crypto.test.ts`

**Interfaces:**
- Consumes: `AiSdkByokValidationError` from `ai-sdk-byok`.
- Produces (used by Tasks 4, 5): from `./crypto.js` —
  `type EncryptionKeyInput = string | (() => string | Promise<string>)`;
  `interface CredentialSealer { seal(plaintext: string, aad: string): Promise<string>; unseal(sealed: string, aad: string): Promise<string> }`;
  `function createSealer(encryptionKey: EncryptionKeyInput): CredentialSealer`;
  `function credentialAad(...parts: string[]): string`.

- [ ] **Step 1: Scaffold the package**

`packages/cloudflare/package.json`:

```json
{
  "name": "@ai-sdk-byok/cloudflare",
  "version": "0.2.0",
  "description": "Cloudflare D1 storage adapter and Workers KV credential cache for ai-sdk-byok.",
  "license": "MIT",
  "homepage": "https://github.com/Xyri1/ai-sdk-byok#readme",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/Xyri1/ai-sdk-byok.git",
    "directory": "packages/cloudflare"
  },
  "bugs": {
    "url": "https://github.com/Xyri1/ai-sdk-byok/issues"
  },
  "type": "module",
  "sideEffects": false,
  "engines": {
    "node": ">=22"
  },
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": [
    "dist",
    "LICENSE",
    "migrations",
    "README.md"
  ],
  "dependencies": {
    "ai-sdk-byok": "0.2.0"
  }
}
```

`packages/cloudflare/src/index.ts` (placeholder until Tasks 4–5 add exports):

```ts
export {};
```

Copy the license: `cp LICENSE packages/cloudflare/LICENSE`

In `tsup.config.ts`, append to the `defineConfig` array:

```ts
  {
    ...shared,
    entry: ['packages/cloudflare/src/index.ts'],
    external: ['ai-sdk-byok'],
    outDir: 'packages/cloudflare/dist',
  },
```

In `tsconfig.json` `compilerOptions.paths`, add:

```json
      "@ai-sdk-byok/cloudflare": ["./packages/cloudflare/src/index.ts"]
```

Then run: `npm install`
Expected: lockfile picks up the new workspace; no errors.

- [ ] **Step 2: Write the failing crypto tests**

`packages/cloudflare/src/crypto.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { AiSdkByokValidationError } from 'ai-sdk-byok';
import { createSealer, credentialAad } from './crypto.js';

const TEST_KEY = Buffer.from(new Uint8Array(32).fill(7)).toString('base64');
const OTHER_KEY = Buffer.from(new Uint8Array(32).fill(9)).toString('base64');

describe('credentialAad', () => {
  it('joins parts with NUL separators', () => {
    expect(credentialAad('user_1', 'openai', 'default')).toBe('user_1\0openai\0default');
  });
});

describe('createSealer', () => {
  it('round-trips plaintext with matching aad', async () => {
    const sealer = createSealer(TEST_KEY);
    const sealed = await sealer.seal('{"apiKey":"sk-test-1234"}', 'aad-1');

    expect(sealed.startsWith('v1.')).toBe(true);
    expect(sealed).not.toContain('sk-test-1234');
    await expect(sealer.unseal(sealed, 'aad-1')).resolves.toBe('{"apiKey":"sk-test-1234"}');
  });

  it('produces distinct ciphertexts for identical plaintext (fresh IV)', async () => {
    const sealer = createSealer(TEST_KEY);
    const first = await sealer.seal('same', 'aad');
    const second = await sealer.seal('same', 'aad');

    expect(first).not.toBe(second);
  });

  it('rejects unsealing with a different key', async () => {
    const sealed = await createSealer(TEST_KEY).seal('secret', 'aad');

    await expect(createSealer(OTHER_KEY).unseal(sealed, 'aad')).rejects.toThrow(
      'Sealed credential payload failed to decrypt',
    );
  });

  it('rejects unsealing with mismatched aad', async () => {
    const sealer = createSealer(TEST_KEY);
    const sealed = await sealer.seal('secret', 'user_a\0openai\0default');

    await expect(sealer.unseal(sealed, 'user_b\0openai\0default')).rejects.toThrow(
      'Sealed credential payload failed to decrypt',
    );
  });

  it('rejects tampered payloads', async () => {
    const sealer = createSealer(TEST_KEY);
    const sealed = await sealer.seal('secret', 'aad');
    const tampered = sealed.slice(0, -2) + (sealed.endsWith('AA') ? 'BB' : 'AA');

    await expect(sealer.unseal(tampered, 'aad')).rejects.toThrow();
  });

  it('rejects unsupported format versions', async () => {
    const sealer = createSealer(TEST_KEY);
    const sealed = await sealer.seal('secret', 'aad');

    await expect(sealer.unseal(sealed.replace(/^v1\./, 'v9.'), 'aad')).rejects.toThrow(
      'Sealed credential payload has an unsupported format',
    );
  });

  it('rejects a string key of the wrong length at construction', () => {
    expect(() => createSealer(Buffer.from('short').toString('base64'))).toThrow(AiSdkByokValidationError);
  });

  it('rejects a non-base64 string key at construction', () => {
    expect(() => createSealer('!!!not-base64!!!')).toThrow(AiSdkByokValidationError);
  });

  it('resolves a getter key lazily, validates it, and memoizes it', async () => {
    const getter = vi.fn(async () => TEST_KEY);
    const sealer = createSealer(getter);

    expect(getter).not.toHaveBeenCalled();
    await sealer.seal('one', 'aad');
    await sealer.seal('two', 'aad');
    expect(getter).toHaveBeenCalledTimes(1);
  });

  it('rejects a getter that returns a wrong-length key', async () => {
    const sealer = createSealer(async () => Buffer.from('short').toString('base64'));

    await expect(sealer.seal('x', 'aad')).rejects.toThrow(AiSdkByokValidationError);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run packages/cloudflare/src/crypto.test.ts`
Expected: FAIL — cannot resolve `./crypto.js`.

- [ ] **Step 4: Implement `packages/cloudflare/src/crypto.ts`**

```ts
import { AiSdkByokValidationError } from 'ai-sdk-byok';

export type EncryptionKeyInput = string | (() => string | Promise<string>);

export interface CredentialSealer {
  seal(plaintext: string, aad: string): Promise<string>;
  unseal(sealed: string, aad: string): Promise<string>;
}

const FORMAT_VERSION = 'v1';
const IV_LENGTH_BYTES = 12;
const KEY_LENGTH_BYTES = 32;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function credentialAad(...parts: string[]): string {
  return parts.join('\0');
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/');
  return decodeBase64(padded + '='.repeat((4 - (padded.length % 4)) % 4));
}

function decodeKeyMaterial(value: string): Uint8Array {
  let bytes: Uint8Array;
  try {
    bytes = decodeBase64(value.trim());
  } catch {
    throw new AiSdkByokValidationError('encryptionKey must be a base64-encoded string');
  }

  if (bytes.length !== KEY_LENGTH_BYTES) {
    throw new AiSdkByokValidationError('encryptionKey must decode to exactly 32 bytes');
  }

  return bytes;
}

export function createSealer(encryptionKey: EncryptionKeyInput): CredentialSealer {
  if (typeof encryptionKey === 'string') {
    decodeKeyMaterial(encryptionKey);
  }

  let keyPromise: Promise<CryptoKey> | null = null;

  function importKey(): Promise<CryptoKey> {
    keyPromise ??= (async () => {
      const material = typeof encryptionKey === 'string' ? encryptionKey : await encryptionKey();
      return crypto.subtle.importKey('raw', decodeKeyMaterial(material), { name: 'AES-GCM' }, false, [
        'encrypt',
        'decrypt',
      ]);
    })().catch((error: unknown) => {
      keyPromise = null;
      throw error;
    });
    return keyPromise;
  }

  return {
    async seal(plaintext, aad) {
      const key = await importKey();
      const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));
      const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: encoder.encode(aad) },
        key,
        encoder.encode(plaintext),
      );

      return `${FORMAT_VERSION}.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(ciphertext))}`;
    },

    async unseal(sealed, aad) {
      const [version, ivSegment, dataSegment, ...rest] = sealed.split('.');

      if (version !== FORMAT_VERSION || ivSegment === undefined || dataSegment === undefined || rest.length > 0) {
        throw new Error('Sealed credential payload has an unsupported format');
      }

      const key = await importKey();

      try {
        const plaintext = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: fromBase64Url(ivSegment), additionalData: encoder.encode(aad) },
          key,
          fromBase64Url(dataSegment),
        );
        return decoder.decode(plaintext);
      } catch {
        throw new Error('Sealed credential payload failed to decrypt');
      }
    },
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run packages/cloudflare/src/crypto.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 6: Run typecheck, lint, and build**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: all pass; `packages/cloudflare/dist/index.js` produced.

- [ ] **Step 7: Commit**

```bash
git add packages/cloudflare tsup.config.ts tsconfig.json package-lock.json
git commit -m "feat(cloudflare): scaffold package with sealed-credential crypto"
```

---

### Task 3: D1 migration + SQLite-backed test shim

**Files:**
- Create: `packages/cloudflare/migrations/0001_ai_sdk_byok_init.sql`
- Create: `packages/cloudflare/src/test-helpers/d1.ts`
- Modify: `package.json` (root — add dev dependencies)
- Test: `packages/cloudflare/src/test-helpers/d1.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces (used by Tasks 4, 6): from `./test-helpers/d1.js` —
  `interface FakeD1Database { prepare(sql: string): { bind(...values: unknown[]): …; first<T>(): Promise<T | null>; all<T>(): Promise<{ results: T[] }>; run(): Promise<void> } }`;
  `function createFakeD1(): FakeD1Database & { close(): void }` — in-memory SQLite with the migration pre-applied.

- [ ] **Step 1: Add dev dependencies**

Run: `npm install --save-dev better-sqlite3@^12.2.0 @types/better-sqlite3@^7.6.13`
Expected: added to root `package.json` devDependencies; native build succeeds on Node 22.

- [ ] **Step 2: Write the migration**

`packages/cloudflare/migrations/0001_ai_sdk_byok_init.sql`:

```sql
CREATE TABLE ai_sdk_byok_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT 'default',
  key_hint TEXT NOT NULL,
  credentials_ciphertext TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, provider, label),
  CHECK (length(user_id) BETWEEN 1 AND 256),
  CHECK (length(provider) BETWEEN 1 AND 128),
  CHECK (length(label) BETWEEN 1 AND 128),
  CHECK (length(key_hint) BETWEEN 1 AND 4)
);

CREATE INDEX ai_sdk_byok_keys_user_list_idx
  ON ai_sdk_byok_keys (user_id, updated_at DESC, created_at DESC);
```

- [ ] **Step 3: Write the failing shim smoke test**

`packages/cloudflare/src/test-helpers/d1.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { createFakeD1, type FakeD1Database } from './d1.js';

const INSERT_SQL = `
INSERT INTO ai_sdk_byok_keys (id, user_id, provider, label, key_hint, credentials_ciphertext, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (user_id, provider, label) DO UPDATE SET
  key_hint = excluded.key_hint,
  credentials_ciphertext = excluded.credentials_ciphertext,
  updated_at = excluded.updated_at
RETURNING id, user_id, provider, label, key_hint, created_at, updated_at;
`;

interface MetadataRow {
  id: string;
  created_at: string;
  updated_at: string;
  key_hint: string;
}

let db: (FakeD1Database & { close(): void }) | null = null;

afterEach(() => {
  db?.close();
  db = null;
});

describe('createFakeD1', () => {
  it('applies the migration and supports upsert with RETURNING', async () => {
    db = createFakeD1();

    const inserted = await db
      .prepare(INSERT_SQL)
      .bind('id-1', 'user_1', 'openai', 'default', '1234', 'v1.sealed', '2026-07-17T00:00:00.000Z', '2026-07-17T00:00:00.000Z')
      .first<MetadataRow>();

    expect(inserted?.id).toBe('id-1');

    const rotated = await db
      .prepare(INSERT_SQL)
      .bind('id-2', 'user_1', 'openai', 'default', '5678', 'v1.sealed2', '2026-07-18T00:00:00.000Z', '2026-07-18T00:00:00.000Z')
      .first<MetadataRow>();

    expect(rotated?.id).toBe('id-1');
    expect(rotated?.created_at).toBe('2026-07-17T00:00:00.000Z');
    expect(rotated?.updated_at).toBe('2026-07-18T00:00:00.000Z');
    expect(rotated?.key_hint).toBe('5678');
  });

  it('supports all() and idempotent run()', async () => {
    db = createFakeD1();

    const empty = await db.prepare('SELECT * FROM ai_sdk_byok_keys;').all();
    expect(empty.results).toEqual([]);

    await db.prepare('DELETE FROM ai_sdk_byok_keys WHERE id = ?;').bind('missing').run();
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run packages/cloudflare/src/test-helpers/d1.test.ts`
Expected: FAIL — cannot resolve `./d1.js`.

- [ ] **Step 5: Implement `packages/cloudflare/src/test-helpers/d1.ts`**

Test-only helper — Node imports are allowed here and this file is not reachable from `src/index.ts`, so nothing Node-only ships in the build.

```ts
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';

const MIGRATION_URL = new URL('../../migrations/0001_ai_sdk_byok_init.sql', import.meta.url);

interface FakeD1PreparedStatement {
  bind(...values: unknown[]): FakeD1PreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[] }>;
  run(): Promise<void>;
}

export interface FakeD1Database {
  prepare(sql: string): FakeD1PreparedStatement;
}

export function createFakeD1(): FakeD1Database & { close(): void } {
  const db = new Database(':memory:');
  db.exec(readFileSync(MIGRATION_URL, 'utf8'));

  function createStatement(sql: string, values: unknown[]): FakeD1PreparedStatement {
    return {
      bind(...next: unknown[]) {
        return createStatement(sql, next);
      },
      async first<T>() {
        return ((db.prepare(sql).get(...values) as T | undefined) ?? null);
      },
      async all<T>() {
        return { results: db.prepare(sql).all(...values) as T[] };
      },
      async run() {
        db.prepare(sql).run(...values);
      },
    };
  }

  return {
    prepare(sql: string) {
      return createStatement(sql, []);
    },
    close() {
      db.close();
    },
  };
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run packages/cloudflare/src/test-helpers/d1.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/cloudflare/migrations packages/cloudflare/src/test-helpers package.json package-lock.json
git commit -m "feat(cloudflare): add d1 migration and sqlite-backed test shim"
```

---

### Task 4: `d1Adapter` storage adapter

**Files:**
- Create: `packages/cloudflare/src/d1-adapter.ts`
- Modify: `packages/cloudflare/src/index.ts`
- Test: `packages/cloudflare/src/d1-adapter.test.ts`

**Interfaces:**
- Consumes: `createSealer`, `credentialAad`, `EncryptionKeyInput` from `./crypto.js` (Task 2); `createFakeD1` from `./test-helpers/d1.js` (Task 3); `AiSdkByokAdapterError`, `ByokManagerOptions`, types from `ai-sdk-byok`.
- Produces (used by Task 6 and integrators): from `./d1-adapter.js` —
  `interface D1AdapterOptions { database: unknown; encryptionKey: EncryptionKeyInput }`;
  `function d1Adapter(options: D1AdapterOptions): ByokManagerOptions['storage']`.

- [ ] **Step 1: Write the failing adapter tests**

`packages/cloudflare/src/d1-adapter.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiSdkByokAdapterError, AiSdkByokValidationError } from 'ai-sdk-byok';
import { d1Adapter } from './d1-adapter.js';
import { createFakeD1, type FakeD1Database } from './test-helpers/d1.js';

const TEST_KEY = Buffer.from(new Uint8Array(32).fill(7)).toString('base64');

const saveInput = {
  userId: 'user_1',
  provider: 'openai',
  label: 'default',
  credentials: { apiKey: 'sk-test-1234' },
  keyHint: '1234',
};

let database: (FakeD1Database & { close(): void }) | null = null;

function createAdapter() {
  database = createFakeD1();
  return d1Adapter({ database, encryptionKey: TEST_KEY });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-17T00:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
  database?.close();
  database = null;
});

describe('d1Adapter', () => {
  it('rejects a wrong-length encryption key at construction', () => {
    expect(() => d1Adapter({ database: {}, encryptionKey: 'dG9vLXNob3J0' })).toThrow(AiSdkByokValidationError);
  });

  it('saves sealed credentials and returns metadata only', async () => {
    const adapter = createAdapter();

    const metadata = await adapter.save(saveInput);

    expect(metadata).toEqual({
      id: expect.any(String),
      userId: 'user_1',
      provider: 'openai',
      label: 'default',
      keyHint: '1234',
      createdAt: '2026-07-17T00:00:00.000Z',
      updatedAt: '2026-07-17T00:00:00.000Z',
    });
    expect(JSON.stringify(metadata)).not.toContain('sk-test-1234');

    const stored = await database!
      .prepare('SELECT credentials_ciphertext FROM ai_sdk_byok_keys;')
      .first<{ credentials_ciphertext: string }>();
    expect(stored?.credentials_ciphertext.startsWith('v1.')).toBe(true);
    expect(stored?.credentials_ciphertext).not.toContain('sk-test-1234');
  });

  it('rotation preserves id and createdAt while updating hint and updatedAt', async () => {
    const adapter = createAdapter();
    const original = await adapter.save(saveInput);

    vi.setSystemTime(new Date('2026-07-18T00:00:00.000Z'));
    const rotated = await adapter.save({ ...saveInput, credentials: { apiKey: 'sk-test-9999' }, keyHint: '9999' });

    expect(rotated.id).toBe(original.id);
    expect(rotated.createdAt).toBe('2026-07-17T00:00:00.000Z');
    expect(rotated.updatedAt).toBe('2026-07-18T00:00:00.000Z');
    expect(rotated.keyHint).toBe('9999');
    await expect(adapter.get(saveInput)).resolves.toEqual({ apiKey: 'sk-test-9999' });
  });

  it('lists metadata ordered by updatedAt then createdAt descending, without ciphertext', async () => {
    const adapter = createAdapter();
    await adapter.save(saveInput);
    vi.setSystemTime(new Date('2026-07-18T00:00:00.000Z'));
    await adapter.save({ ...saveInput, provider: 'anthropic', keyHint: '5678' });

    const list = await adapter.list({ userId: 'user_1' });

    expect(list.map((entry) => entry.provider)).toEqual(['anthropic', 'openai']);
    for (const entry of list) {
      expect(entry).not.toHaveProperty('credentials_ciphertext');
      expect(entry).not.toHaveProperty('credentials');
    }
  });

  it('get returns credentials on hit and null on miss', async () => {
    const adapter = createAdapter();
    await adapter.save(saveInput);

    await expect(adapter.get(saveInput)).resolves.toEqual({ apiKey: 'sk-test-1234' });
    await expect(adapter.get({ ...saveInput, provider: 'missing' })).resolves.toBeNull();
  });

  it('rejects ciphertext moved to a different slot (AAD binding)', async () => {
    const adapter = createAdapter();
    await adapter.save(saveInput);
    await adapter.save({ ...saveInput, userId: 'user_2', credentials: { apiKey: 'sk-victim-0000' }, keyHint: '0000' });

    const victim = await database!
      .prepare('SELECT credentials_ciphertext FROM ai_sdk_byok_keys WHERE user_id = ?;')
      .bind('user_2')
      .first<{ credentials_ciphertext: string }>();
    await database!
      .prepare('UPDATE ai_sdk_byok_keys SET credentials_ciphertext = ? WHERE user_id = ?;')
      .bind(victim!.credentials_ciphertext, 'user_1')
      .run();

    await expect(adapter.get(saveInput)).rejects.toThrow(AiSdkByokAdapterError);
  });

  it('getById returns the full record for the owner and null otherwise', async () => {
    const adapter = createAdapter();
    const metadata = await adapter.save(saveInput);

    const record = await adapter.getById({ userId: 'user_1', keyId: metadata.id });
    expect(record?.credentials).toEqual({ apiKey: 'sk-test-1234' });
    expect(record?.id).toBe(metadata.id);

    await expect(adapter.getById({ userId: 'user_2', keyId: metadata.id })).resolves.toBeNull();
  });

  it('delete removes the row and is idempotent', async () => {
    const adapter = createAdapter();
    const metadata = await adapter.save(saveInput);

    await adapter.delete({ userId: 'user_1', keyId: metadata.id });
    await adapter.delete({ userId: 'user_1', keyId: metadata.id });

    await expect(adapter.get(saveInput)).resolves.toBeNull();
  });

  it('wraps database failures in AiSdkByokAdapterError without credential input', async () => {
    const broken = {
      prepare() {
        throw new Error('boom');
      },
    };
    const adapter = d1Adapter({ database: broken, encryptionKey: TEST_KEY });

    const failure = await adapter.save(saveInput).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AiSdkByokAdapterError);
    expect((failure as Error).message).toBe('Cloudflare D1 BYOK adapter failed during save');
    expect((failure as Error).message).not.toContain('sk-test-1234');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/cloudflare/src/d1-adapter.test.ts`
Expected: FAIL — cannot resolve `./d1-adapter.js`.

- [ ] **Step 3: Implement `packages/cloudflare/src/d1-adapter.ts`**

```ts
import {
  AiSdkByokAdapterError,
  type ApiKeyCredentials,
  type ByokManagerOptions,
  type KeyMetadata,
} from 'ai-sdk-byok';
import { createSealer, credentialAad, type EncryptionKeyInput } from './crypto.js';

interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}

interface D1DatabaseLike {
  prepare(sql: string): D1PreparedStatementLike;
}

export interface D1AdapterOptions {
  database: unknown;
  encryptionKey: EncryptionKeyInput;
}

interface KeyMetadataRow {
  id: string;
  user_id: string;
  provider: string;
  label: string;
  key_hint: string;
  created_at: string;
  updated_at: string;
}

interface CredentialRow extends KeyMetadataRow {
  credentials_ciphertext: string;
}

const METADATA_COLUMNS = 'id, user_id, provider, label, key_hint, created_at, updated_at';

const SAVE_SQL = `
INSERT INTO ai_sdk_byok_keys (id, user_id, provider, label, key_hint, credentials_ciphertext, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (user_id, provider, label) DO UPDATE SET
  key_hint = excluded.key_hint,
  credentials_ciphertext = excluded.credentials_ciphertext,
  updated_at = excluded.updated_at
RETURNING ${METADATA_COLUMNS};
`;

const LIST_SQL = `
SELECT ${METADATA_COLUMNS}
FROM ai_sdk_byok_keys
WHERE user_id = ?
ORDER BY updated_at DESC, created_at DESC;
`;

const GET_SQL = `
SELECT credentials_ciphertext
FROM ai_sdk_byok_keys
WHERE user_id = ? AND provider = ? AND label = ?;
`;

const GET_BY_ID_SQL = `
SELECT ${METADATA_COLUMNS}, credentials_ciphertext
FROM ai_sdk_byok_keys
WHERE id = ? AND user_id = ?;
`;

const DELETE_SQL = `
DELETE FROM ai_sdk_byok_keys
WHERE id = ? AND user_id = ?;
`;

function adapterError(operation: string, cause: unknown): AiSdkByokAdapterError {
  return new AiSdkByokAdapterError(`Cloudflare D1 BYOK adapter failed during ${operation}`, { cause });
}

function toMetadata(row: KeyMetadataRow): KeyMetadata {
  return {
    id: row.id,
    userId: row.user_id,
    provider: row.provider,
    label: row.label,
    keyHint: row.key_hint,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseCredentials(plaintext: string): ApiKeyCredentials {
  const parsed: unknown = JSON.parse(plaintext);

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed) ||
    Object.keys(parsed).length !== 1 ||
    typeof (parsed as { apiKey?: unknown }).apiKey !== 'string'
  ) {
    throw new Error('Sealed credential payload has an invalid shape');
  }

  return { apiKey: (parsed as { apiKey: string }).apiKey };
}

export function d1Adapter(options: D1AdapterOptions): ByokManagerOptions['storage'] {
  const database = options.database as D1DatabaseLike;
  const sealer = createSealer(options.encryptionKey);

  return {
    async save(input) {
      try {
        const sealed = await sealer.seal(
          JSON.stringify(input.credentials),
          credentialAad(input.userId, input.provider, input.label),
        );
        const now = new Date().toISOString();
        const row = await database
          .prepare(SAVE_SQL)
          .bind(crypto.randomUUID(), input.userId, input.provider, input.label, input.keyHint, sealed, now, now)
          .first<KeyMetadataRow>();

        if (row === null) {
          throw new Error('Save did not return a metadata row');
        }

        return toMetadata(row);
      } catch (error) {
        throw adapterError('save', error);
      }
    },

    async list(input) {
      try {
        const { results } = await database.prepare(LIST_SQL).bind(input.userId).all<KeyMetadataRow>();
        return results.map(toMetadata);
      } catch (error) {
        throw adapterError('list', error);
      }
    },

    async get(input) {
      try {
        const row = await database
          .prepare(GET_SQL)
          .bind(input.userId, input.provider, input.label)
          .first<Pick<CredentialRow, 'credentials_ciphertext'>>();

        if (row === null) {
          return null;
        }

        const plaintext = await sealer.unseal(
          row.credentials_ciphertext,
          credentialAad(input.userId, input.provider, input.label),
        );
        return parseCredentials(plaintext);
      } catch (error) {
        throw adapterError('get', error);
      }
    },

    async getById(input) {
      try {
        const row = await database.prepare(GET_BY_ID_SQL).bind(input.keyId, input.userId).first<CredentialRow>();

        if (row === null) {
          return null;
        }

        const plaintext = await sealer.unseal(
          row.credentials_ciphertext,
          credentialAad(row.user_id, row.provider, row.label),
        );
        return { ...toMetadata(row), credentials: parseCredentials(plaintext) };
      } catch (error) {
        throw adapterError('getById', error);
      }
    },

    async delete(input) {
      try {
        await database.prepare(DELETE_SQL).bind(input.keyId, input.userId).run();
      } catch (error) {
        throw adapterError('delete', error);
      }
    },
  };
}
```

Update `packages/cloudflare/src/index.ts` to:

```ts
export { d1Adapter } from './d1-adapter.js';
export type { D1AdapterOptions } from './d1-adapter.js';
export type { EncryptionKeyInput } from './crypto.js';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/cloudflare/src/d1-adapter.test.ts`
Expected: PASS (9 tests).

Note: the construction-time key check happens inside `createSealer` (Task 2) before any database call, so the first test passes even though `database: {}` is not a usable binding.

- [ ] **Step 5: Run the full suite, typecheck, and build**

Run: `npm run typecheck && npm run test && npm run build`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add packages/cloudflare/src/d1-adapter.ts packages/cloudflare/src/d1-adapter.test.ts packages/cloudflare/src/index.ts
git commit -m "feat(cloudflare): add d1 storage adapter with sealed credentials"
```

---

### Task 5: `kvCredentialCache`

**Files:**
- Create: `packages/cloudflare/src/kv-cache.ts`
- Create: `packages/cloudflare/src/test-helpers/kv.ts`
- Modify: `packages/cloudflare/src/index.ts`
- Test: `packages/cloudflare/src/kv-cache.test.ts`

**Interfaces:**
- Consumes: `createSealer`, `credentialAad`, `EncryptionKeyInput` from `./crypto.js`; `CredentialRecordCache`, `GetStorageByIdInput`, `StoredKeyCredentialRecord`, `AiSdkByokAdapterError` from `ai-sdk-byok`.
- Produces (used by Task 6 and integrators): from `./kv-cache.js` —
  `interface KvCredentialCacheOptions { namespace: unknown; encryptionKey: EncryptionKeyInput; keyPrefix?: string }`;
  `function kvCredentialCache(options: KvCredentialCacheOptions): CredentialRecordCache`.
  From `./test-helpers/kv.js` — `function createFakeKv(): { get; put; delete; entries: Map<string, { value: string; expirationTtl: number | null }> }`.

- [ ] **Step 1: Write the KV fake**

`packages/cloudflare/src/test-helpers/kv.ts`:

```ts
export interface FakeKvEntry {
  value: string;
  expirationTtl: number | null;
}

export interface FakeKvNamespace {
  entries: Map<string, FakeKvEntry>;
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

export function createFakeKv(): FakeKvNamespace {
  const entries = new Map<string, FakeKvEntry>();

  return {
    entries,
    async get(key) {
      return entries.get(key)?.value ?? null;
    },
    async put(key, value, options) {
      entries.set(key, { value, expirationTtl: options?.expirationTtl ?? null });
    },
    async delete(key) {
      entries.delete(key);
    },
  };
}
```

- [ ] **Step 2: Write the failing cache tests**

`packages/cloudflare/src/kv-cache.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import { AiSdkByokAdapterError, type StoredKeyCredentialRecord } from 'ai-sdk-byok';
import { kvCredentialCache } from './kv-cache.js';
import { createFakeKv } from './test-helpers/kv.js';

const TEST_KEY = Buffer.from(new Uint8Array(32).fill(7)).toString('base64');
const OTHER_KEY = Buffer.from(new Uint8Array(32).fill(9)).toString('base64');

const record: StoredKeyCredentialRecord = {
  id: 'key_1',
  userId: 'user_1',
  provider: 'openai',
  label: 'default',
  keyHint: '1234',
  createdAt: '2026-07-17T00:00:00.000Z',
  updatedAt: '2026-07-17T00:00:00.000Z',
  credentials: { apiKey: 'sk-test-1234' },
};

const slot = { userId: 'user_1', keyId: 'key_1' };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-17T00:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('kvCredentialCache', () => {
  it('round-trips a record and stores only sealed values under hashed keys', async () => {
    const namespace = createFakeKv();
    const cache = kvCredentialCache({ namespace, encryptionKey: TEST_KEY });

    await cache.set(slot, record, { ttlMs: 300_000 });

    expect(namespace.entries.size).toBe(1);
    const [key, entry] = [...namespace.entries][0]!;
    expect(key).toMatch(/^ai-sdk-byok:[0-9a-f]{64}$/);
    expect(key).not.toContain('user_1');
    expect(entry.value.startsWith('v1.')).toBe(true);
    expect(entry.value).not.toContain('sk-test-1234');
    expect(entry.expirationTtl).toBe(300);

    await expect(cache.get(slot)).resolves.toEqual(record);
  });

  it('honors a custom key prefix', async () => {
    const namespace = createFakeKv();
    const cache = kvCredentialCache({ namespace, encryptionKey: TEST_KEY, keyPrefix: 'custom:' });

    await cache.set(slot, record, { ttlMs: 120_000 });

    expect([...namespace.entries.keys()][0]).toMatch(/^custom:[0-9a-f]{64}$/);
  });

  it('clamps physical expirationTtl to the KV 60-second floor', async () => {
    const namespace = createFakeKv();
    const cache = kvCredentialCache({ namespace, encryptionKey: TEST_KEY });

    await cache.set(slot, record, { ttlMs: 15_000 });

    expect([...namespace.entries.values()][0]!.expirationTtl).toBe(60);
  });

  it('enforces logical expiry below the physical floor', async () => {
    const namespace = createFakeKv();
    const cache = kvCredentialCache({ namespace, encryptionKey: TEST_KEY });
    await cache.set(slot, record, { ttlMs: 15_000 });

    vi.setSystemTime(new Date('2026-07-17T00:00:20.000Z'));

    await expect(cache.get(slot)).resolves.toBeNull();
    expect(namespace.entries.size).toBe(0);
  });

  it('treats undecryptable entries as misses and evicts them', async () => {
    const namespace = createFakeKv();
    await kvCredentialCache({ namespace, encryptionKey: OTHER_KEY }).set(slot, record, { ttlMs: 300_000 });

    const cache = kvCredentialCache({ namespace, encryptionKey: TEST_KEY });

    await expect(cache.get(slot)).resolves.toBeNull();
    expect(namespace.entries.size).toBe(0);
  });

  it('rejects entries replayed under a different slot (AAD binding)', async () => {
    const namespace = createFakeKv();
    const cache = kvCredentialCache({ namespace, encryptionKey: TEST_KEY });
    await cache.set(slot, record, { ttlMs: 300_000 });
    const sealed = [...namespace.entries.values()][0]!.value;

    const otherSlot = { userId: 'user_2', keyId: 'key_1' };
    const otherCache = kvCredentialCache({ namespace, encryptionKey: TEST_KEY });
    await otherCache.set(otherSlot, { ...record, userId: 'user_2' }, { ttlMs: 300_000 });
    const otherKey = [...namespace.entries.keys()].find((key) => namespace.entries.get(key)!.value !== sealed)!;
    namespace.entries.set(otherKey, { value: sealed, expirationTtl: 300 });

    await expect(otherCache.get(otherSlot)).resolves.toBeNull();
  });

  it('deletes entries', async () => {
    const namespace = createFakeKv();
    const cache = kvCredentialCache({ namespace, encryptionKey: TEST_KEY });
    await cache.set(slot, record, { ttlMs: 300_000 });

    await cache.delete(slot);

    expect(namespace.entries.size).toBe(0);
    await expect(cache.get(slot)).resolves.toBeNull();
  });

  it('wraps namespace failures in AiSdkByokAdapterError', async () => {
    const cache = kvCredentialCache({
      namespace: {
        async get() {
          throw new Error('kv down');
        },
        async put() {
          throw new Error('kv down');
        },
        async delete() {
          throw new Error('kv down');
        },
      },
      encryptionKey: TEST_KEY,
    });

    await expect(cache.get(slot)).rejects.toThrow(AiSdkByokAdapterError);
    await expect(cache.set(slot, record, { ttlMs: 60_000 })).rejects.toThrow(AiSdkByokAdapterError);
    await expect(cache.delete(slot)).rejects.toThrow(AiSdkByokAdapterError);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run packages/cloudflare/src/kv-cache.test.ts`
Expected: FAIL — cannot resolve `./kv-cache.js`.

- [ ] **Step 4: Implement `packages/cloudflare/src/kv-cache.ts`**

```ts
import {
  AiSdkByokAdapterError,
  type CredentialRecordCache,
  type GetStorageByIdInput,
  type StoredKeyCredentialRecord,
} from 'ai-sdk-byok';
import { createSealer, credentialAad, type EncryptionKeyInput } from './crypto.js';

interface KvNamespaceLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface KvCredentialCacheOptions {
  namespace: unknown;
  encryptionKey: EncryptionKeyInput;
  keyPrefix?: string;
}

interface CachePayload {
  record: StoredKeyCredentialRecord;
  expiresAt: number;
}

const DEFAULT_KEY_PREFIX = 'ai-sdk-byok:';
const MIN_KV_EXPIRATION_SECONDS = 60;

const encoder = new TextEncoder();

function cacheError(operation: string, cause: unknown): AiSdkByokAdapterError {
  return new AiSdkByokAdapterError(`Cloudflare KV BYOK credential cache failed during ${operation}`, { cause });
}

async function cacheKey(prefix: string, input: GetStorageByIdInput): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(credentialAad(input.userId, input.keyId)));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${prefix}${hex}`;
}

function parsePayload(plaintext: string): CachePayload {
  const parsed: unknown = JSON.parse(plaintext);

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as { expiresAt?: unknown }).expiresAt !== 'number' ||
    typeof (parsed as { record?: unknown }).record !== 'object' ||
    (parsed as { record: unknown }).record === null ||
    typeof ((parsed as { record: { credentials?: { apiKey?: unknown } } }).record.credentials?.apiKey) !== 'string'
  ) {
    throw new Error('Cache payload has an invalid shape');
  }

  return parsed as CachePayload;
}

export function kvCredentialCache(options: KvCredentialCacheOptions): CredentialRecordCache {
  const namespace = options.namespace as KvNamespaceLike;
  const sealer = createSealer(options.encryptionKey);
  const prefix = options.keyPrefix ?? DEFAULT_KEY_PREFIX;

  async function bestEffortDelete(key: string): Promise<void> {
    try {
      await namespace.delete(key);
    } catch {
      // Physical expirationTtl remains as the cleanup backstop.
    }
  }

  return {
    async get(input) {
      const key = await cacheKey(prefix, input);

      let raw: string | null;
      try {
        raw = await namespace.get(key);
      } catch (error) {
        throw cacheError('get', error);
      }

      if (raw === null) {
        return null;
      }

      let payload: CachePayload;
      try {
        payload = parsePayload(await sealer.unseal(raw, credentialAad(input.userId, input.keyId)));
      } catch {
        await bestEffortDelete(key);
        return null;
      }

      if (payload.expiresAt <= Date.now()) {
        await bestEffortDelete(key);
        return null;
      }

      return payload.record;
    },

    async set(input, record, setOptions) {
      const key = await cacheKey(prefix, input);

      try {
        const payload: CachePayload = { record, expiresAt: Date.now() + setOptions.ttlMs };
        const sealed = await sealer.seal(JSON.stringify(payload), credentialAad(input.userId, input.keyId));
        await namespace.put(key, sealed, {
          expirationTtl: Math.max(MIN_KV_EXPIRATION_SECONDS, Math.ceil(setOptions.ttlMs / 1000)),
        });
      } catch (error) {
        throw cacheError('set', error);
      }
    },

    async delete(input) {
      const key = await cacheKey(prefix, input);

      try {
        await namespace.delete(key);
      } catch (error) {
        throw cacheError('delete', error);
      }
    },
  };
}
```

Update `packages/cloudflare/src/index.ts` to:

```ts
export { d1Adapter } from './d1-adapter.js';
export type { D1AdapterOptions } from './d1-adapter.js';
export { kvCredentialCache } from './kv-cache.js';
export type { KvCredentialCacheOptions } from './kv-cache.js';
export type { EncryptionKeyInput } from './crypto.js';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run packages/cloudflare/src/kv-cache.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 6: Run the full suite, typecheck, and build**

Run: `npm run typecheck && npm run test && npm run build`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add packages/cloudflare/src/kv-cache.ts packages/cloudflare/src/kv-cache.test.ts packages/cloudflare/src/test-helpers/kv.ts packages/cloudflare/src/index.ts
git commit -m "feat(cloudflare): add kv credential cache with logical ttl"
```

---

### Task 6: End-to-end composition + security-invariant tests

**Files:**
- Test: `packages/cloudflare/src/integration.test.ts`

**Interfaces:**
- Consumes: `createByokManager`, `cachedStorage` from `ai-sdk-byok`; `d1Adapter` (Task 4); `kvCredentialCache` (Task 5); `createFakeD1` (Task 3); `createFakeKv` (Task 5).
- Produces: proof that the README composition works and the security invariants hold end to end.

- [ ] **Step 1: Write the integration tests**

`packages/cloudflare/src/integration.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { cachedStorage, createByokManager } from 'ai-sdk-byok';
import { d1Adapter } from './d1-adapter.js';
import { kvCredentialCache } from './kv-cache.js';
import { createFakeD1, type FakeD1Database } from './test-helpers/d1.js';
import { createFakeKv } from './test-helpers/kv.js';

const TEST_KEY = Buffer.from(new Uint8Array(32).fill(7)).toString('base64');

let database: (FakeD1Database & { close(): void }) | null = null;

function createManager() {
  database = createFakeD1();
  const namespace = createFakeKv();
  const manager = createByokManager({
    storage: cachedStorage({
      storage: d1Adapter({ database, encryptionKey: TEST_KEY }),
      cache: kvCredentialCache({ namespace, encryptionKey: TEST_KEY }),
      ttlMs: 60_000,
    }),
  });
  return { manager, namespace };
}

afterEach(() => {
  database?.close();
  database = null;
});

describe('cloudflare adapter end to end', () => {
  it('save and list stay metadata-only', async () => {
    const { manager } = createManager();

    const metadata = await manager.keys.save({
      userId: 'user_1',
      provider: 'openai',
      credentials: { apiKey: 'sk-e2e-1234' },
    });
    const list = await manager.keys.list({ userId: 'user_1' });

    expect(metadata.keyHint).toBe('1234');
    expect(JSON.stringify(metadata)).not.toContain('sk-e2e-1234');
    expect(JSON.stringify(list)).not.toContain('sk-e2e-1234');
  });

  it('getById serves from the cache after the first read', async () => {
    const { manager } = createManager();
    const metadata = await manager.keys.save({
      userId: 'user_1',
      provider: 'openai',
      credentials: { apiKey: 'sk-e2e-1234' },
    });

    const first = await manager.keys.getById({ userId: 'user_1', keyId: metadata.id });
    expect(first?.credentials.apiKey).toBe('sk-e2e-1234');

    await database!.prepare('DELETE FROM ai_sdk_byok_keys;').run();

    const second = await manager.keys.getById({ userId: 'user_1', keyId: metadata.id });
    expect(second?.credentials.apiKey).toBe('sk-e2e-1234');
  });

  it('returned credentials resist JSON.stringify leakage', async () => {
    const { manager } = createManager();
    const metadata = await manager.keys.save({
      userId: 'user_1',
      provider: 'openai',
      credentials: { apiKey: 'sk-e2e-1234' },
    });

    const record = await manager.keys.getById({ userId: 'user_1', keyId: metadata.id });
    const credentials = await manager.keys.get({ userId: 'user_1', provider: 'openai' });

    expect(record?.credentials.apiKey).toBe('sk-e2e-1234');
    expect(credentials?.apiKey).toBe('sk-e2e-1234');
    expect(JSON.stringify(record)).not.toContain('sk-e2e-1234');
    expect(JSON.stringify(credentials)).not.toContain('sk-e2e-1234');
  });

  it('rotation invalidates the cache', async () => {
    const { manager } = createManager();
    const metadata = await manager.keys.save({
      userId: 'user_1',
      provider: 'openai',
      credentials: { apiKey: 'sk-e2e-1234' },
    });
    await manager.keys.getById({ userId: 'user_1', keyId: metadata.id });

    await manager.keys.save({
      userId: 'user_1',
      provider: 'openai',
      credentials: { apiKey: 'sk-e2e-9999' },
    });

    const record = await manager.keys.getById({ userId: 'user_1', keyId: metadata.id });
    expect(record?.credentials.apiKey).toBe('sk-e2e-9999');
  });

  it('delete clears the cache and is idempotent at the manager layer', async () => {
    const { manager, namespace } = createManager();
    const metadata = await manager.keys.save({
      userId: 'user_1',
      provider: 'openai',
      credentials: { apiKey: 'sk-e2e-1234' },
    });
    await manager.keys.getById({ userId: 'user_1', keyId: metadata.id });

    await manager.keys.delete({ userId: 'user_1', keyId: metadata.id });
    await manager.keys.delete({ userId: 'user_1', keyId: metadata.id });

    expect(namespace.entries.size).toBe(0);
    await expect(manager.keys.getById({ userId: 'user_1', keyId: metadata.id })).resolves.toBeNull();
  });
});
```

- [ ] **Step 2: Run the integration tests**

Run: `npx vitest run packages/cloudflare/src/integration.test.ts`
Expected: PASS (5 tests). If the `JSON.stringify` assertions fail, the bug is in this plan's understanding of the core proxy — check `packages/core/src/credential-proxy.ts` and align the assertion with `packages/core/src/manager.test.ts` rather than weakening the invariant.

- [ ] **Step 3: Run the full check**

Run: `npm run check && npm run lint`
Expected: typecheck, all package tests, build, and lint pass.

- [ ] **Step 4: Commit**

```bash
git add packages/cloudflare/src/integration.test.ts
git commit -m "test(cloudflare): add end-to-end composition and security invariant tests"
```

---

### Task 7: Documentation — package README, threat model, architecture, root READMEs

**Files:**
- Create: `packages/cloudflare/README.md`
- Modify: `docs/threat-model.md`
- Modify: `docs/architecture.md`
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `specs/003-cloudflare-adapter/tasks.md` (check off delivered tasks)

**Interfaces:**
- Consumes: final public API from Tasks 4–5.
- Produces: integrator-facing docs; updated threat model claims.

- [ ] **Step 1: Write `packages/cloudflare/README.md`**

```markdown
# @ai-sdk-byok/cloudflare

Cloudflare D1 storage adapter and Workers KV credential cache for [`ai-sdk-byok`](https://github.com/Xyri1/ai-sdk-byok). Credentials are always sealed with AES-256-GCM before touching D1 or KV; the master key lives in a Worker secret or Secrets Store binding.

## Setup

1. Generate a 32-byte master key and store it as a Worker secret:

   ```sh
   openssl rand -base64 32 | wrangler secret put BYOK_MASTER_KEY
   ```

2. Create a D1 database and KV namespace, bind them in `wrangler.jsonc` (for example as `DB` and `BYOK_CACHE`), and apply the shipped migration:

   ```sh
   wrangler d1 migrations apply <DATABASE_NAME> --remote
   ```

   The migration file is `node_modules/@ai-sdk-byok/cloudflare/migrations/0001_ai_sdk_byok_init.sql`; copy it into your project's `migrations/` directory.

## Usage (inside a Worker)

```ts
import { createByokManager, cachedStorage } from 'ai-sdk-byok';
import { d1Adapter, kvCredentialCache } from '@ai-sdk-byok/cloudflare';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const manager = createByokManager({
      storage: cachedStorage({
        storage: d1Adapter({ database: env.DB, encryptionKey: env.BYOK_MASTER_KEY }),
        cache: kvCredentialCache({ namespace: env.BYOK_CACHE, encryptionKey: env.BYOK_MASTER_KEY }),
        ttlMs: 60_000,
      }),
    });

    // save / list / get / getById / delete — see the ai-sdk-byok README.
    // Retrieve plaintext credentials as late as possible, server-side only.
    return new Response('ok');
  },
};
```

Using Secrets Store instead of a Worker secret? Pass a getter: `encryptionKey: () => env.BYOK_KEY_STORE.get()`.

## Security model

- D1 rows and KV values hold only AES-256-GCM ciphertext; a dump of both without the master key exposes nothing.
- Ciphertext is AAD-bound to its slot (`userId`/`provider`/`label` in D1, `userId`/`keyId` in KV) — sealed blobs copied between rows fail decryption.
- Losing the master key means stored credentials are unrecoverable; users re-enter their API keys.
- KV is eventually consistent: a rotated or deleted key may be served from another region until propagation (~60 s) plus remaining TTL. Keep `ttlMs` short.
- See `docs/threat-model.md` in the repository for the full model.

## Capacity

D1 caps a database at 10 GB — roughly 8M stored keys at typical API-key sizes. The schema is shard-friendly (all queries are keyed by `user_id`); shard across multiple D1 databases above that scale.
```

- [ ] **Step 2: Update `docs/threat-model.md`**

Append to **Protects Against**:

```markdown
- Cloudflare D1 or KV data compromise without the Worker master key (values are AES-256-GCM ciphertext).
- Sealed-credential replay across storage slots (ciphertext is AAD-bound to `userId`/`provider`/`label` in D1 and `userId`/`keyId` in KV).
```

Append to **Does Not Protect Against**:

```markdown
- Simultaneous compromise of the Worker master key and D1/KV data.
- Compromised Cloudflare account or dashboard access combined with a leaked master key.
- Immediate global revocation across KV regions; deleted or rotated cache entries can be served elsewhere until propagation plus TTL expiry.
```

Append to **Operational Guidance**:

```markdown
- Generate the Cloudflare master key with a CSPRNG (for example `openssl rand -base64 32`) and store it only in Worker secrets or Secrets Store.
- Losing the master key makes stored credentials unrecoverable by design; users re-enter their API keys.
- Keep KV cache TTLs short; KV invalidation is eventually consistent across regions.
```

- [ ] **Step 3: Update `docs/architecture.md`**

Read the existing document structure first, then add a `## Cloudflare Adapter` section following the existing heading style:

```markdown
## Cloudflare Adapter

`@ai-sdk-byok/cloudflare` targets apps running on Cloudflare Workers. `d1Adapter` implements the core storage contract on a D1 binding; `kvCredentialCache` implements the credential-record cache contract on a KV binding. Both seal credentials with AES-256-GCM (WebCrypto) before writing; the 32-byte master key arrives via a Worker secret string or an async getter (Secrets Store). The sealed format is versioned (`v1.`) so key rotation can be introduced without data migration. `save` is a single-statement upsert with `RETURNING`; `list` never projects the ciphertext column. The KV cache hashes `userId`/`keyId` into fixed-length keys and layers a logical `expiresAt` (sealed, authoritative) over KV's physical `expirationTtl` (floored at 60 s).
```

- [ ] **Step 4: Update root `README.md` and `README.zh-CN.md`**

In `README.md`, locate the adapters/packages section (where `@ai-sdk-byok/supabase` is introduced) and add alongside it:

```markdown
### Cloudflare (D1 + KV)

For apps on Cloudflare Workers, `@ai-sdk-byok/cloudflare` provides a D1 storage adapter and a Workers KV credential cache. Credentials are always sealed with AES-256-GCM before reaching storage; the master key lives in a Worker secret. See `packages/cloudflare/README.md` for setup.
```

In `README.zh-CN.md`, add the equivalent section in the matching location:

```markdown
### Cloudflare（D1 + KV）

对于部署在 Cloudflare Workers 上的应用，`@ai-sdk-byok/cloudflare` 提供 D1 存储适配器和 Workers KV 凭证缓存。凭证在写入存储前始终使用 AES-256-GCM 加密封装；主密钥保存在 Worker secret 中。安装与配置请参阅 `packages/cloudflare/README.md`。
```

- [ ] **Step 5: Check off `specs/003-cloudflare-adapter/tasks.md`**

Mark every delivered item `- [x]` (all seven if this task completes the plan).

- [ ] **Step 6: Final verification**

Run: `npm run check && npm run lint`
Expected: everything passes.

- [ ] **Step 7: Commit**

```bash
git add packages/cloudflare/README.md docs/threat-model.md docs/architecture.md README.md README.zh-CN.md specs/003-cloudflare-adapter/tasks.md
git commit -m "docs: document cloudflare adapter across readmes and threat model"
```

---

## Plan Self-Review Notes

- **Spec coverage:** requirements (adapter contract, sealed format, AAD, TTL layers, hashed KV keys, idempotent delete, ordering, fail-fast key validation, error hygiene) map to Tasks 2–5; security invariants to Tasks 2, 4, 5, 6; docs/spec impact to Tasks 1 and 7; capacity note to Task 7 README.
- **Deliberately out of plan (per spec):** sharded adapter, key-rotation tooling, workerd integration tests (`@cloudflare/vitest-pool-workers`), example Worker app.
- **Type consistency:** `EncryptionKeyInput`, `CredentialSealer`, `createSealer`, `credentialAad` defined once in Task 2 and consumed by name in Tasks 4–5; `FakeD1Database`/`createFakeD1` defined in Task 3 and consumed in Tasks 4, 6; `createFakeKv` defined in Task 5 and consumed in Task 6.
