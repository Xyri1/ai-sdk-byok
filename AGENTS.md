# Project Spec: ai-sdk-byok

`ai-sdk-byok` is a TypeScript monorepo for bring-your-own-key credential storage helpers for AI SDK applications. It provides a core manager package plus Supabase Vault, Cloudflare, and Drizzle SQL adapters so apps can store user-owned provider API keys, list metadata safely, and retrieve plaintext credentials only inside trusted server-side provider construction.

## Read Order

1. **This file** — what the package does, its credential-safety invariants, and the repository layout.
2. **Optional `AGENTS.local.md`** — developer preference on how to develop this project.
3. **Task-relevant files** — read the specific specs, docs, package source, tests, or example files needed for the current change.

## Scope

The current scope is intentionally narrow:

- single-field credentials shaped exactly as `{ apiKey: string }`;
- a core manager package published as `ai-sdk-byok`;
- a Supabase Vault storage adapter published as `@ai-sdk-byok/supabase`;
- Edge-compatible ESM package entrypoints;
- no browser-side credential handling;
- a Cloudflare adapter published as `@ai-sdk-byok/cloudflare` (D1 storage adapter and Workers KV credential cache with always-encrypted sealed credentials);
- a Drizzle SQL adapter published as `@ai-sdk-byok/drizzle` (Postgres storage with application-side AES-256-GCM encryption);

## Source Of Truth

This repository follows spec-driven development. Treat this file as the root project spec for agents and contributors, and treat `docs/specs/001-ai-sdk-byok/` as the baseline feature spec, with `docs/specs/002-key-id-redis-cache/`, `docs/specs/003-drizzle-sql-adapter/`, and `docs/specs/004-cloudflare-adapter/` layering later accepted features. The Drizzle SQL adapter spec is implemented.

When changing behavior, read these in order:

1. `AGENTS.md` for project-level invariants and workflow.
2. `docs/specs/001-ai-sdk-byok/requirements.md` for functional, validation, security, and runtime requirements.
3. `docs/specs/001-ai-sdk-byok/decisions.md` for accepted product and architecture decisions.
4. `docs/specs/001-ai-sdk-byok/tasks.md` for delivery status.
5. `docs/development/architecture.md`, `docs/development/threat-model.md`, and `docs/agent-implementation.md` for operational guidance.

Specs are living documents. If a change alters public behavior, security posture, runtime support, or integration guidance, update the matching spec or doc in the same change. Do not maintain decisions in chat history or commit messages; the spec is the artifact.

## Repository Layout

- `packages/core`: core manager, types, validation, errors, credential proxy, and tests for the `ai-sdk-byok` package.
- `packages/supabase`: Supabase Vault storage adapter, adapter tests, package README, and shipped migrations.
- `packages/cloudflare`: Cloudflare D1 storage adapter, Workers KV credential cache, sealed-credential crypto, tests, package README, and shipped D1 migrations.
- `packages/drizzle`: Drizzle PostgreSQL storage adapter, application-side encryption, adapter tests, package README, and shipped SQL migration.
- `examples/nextjs-supabase`: example Next.js app with key management UI and server-side AI SDK provider construction.
- `examples/cloudflare-worker`: example Hono Worker with key management UI, server-side AI SDK provider construction, and a workerd end-to-end test suite.
- `docs`: user-facing integration docs (getting started, per-adapter guides, API reference, security guide, agent integration guidance) plus `docs/development/` for architecture, threat model, integration testing, and release notes; `llms.txt` at the repo root indexes the user-facing docs for agents.
- `docs/specs/001-ai-sdk-byok`: current requirements, plan, tasks, checklist, and decisions.
- `docs/specs/003-drizzle-sql-adapter`: implemented Drizzle adapter requirements, plan, tasks, checklist, and decisions.
- Root config files: workspace scripts, TypeScript, tsup, Vitest, ESLint, lockfile, and GitHub automation.
- Generated artifacts: `dist` and `node_modules`; do not edit these by hand.

`packages/supabase/migrations` is the single canonical home for the Supabase SQL migrations. Adapter-specific files live under their package; do not reintroduce a root-level copy.

## Public API Requirements

`ai-sdk-byok` exposes `createByokManager(options)` with:

- `keys.save(input)`: validate and store or rotate one credential for `(userId, provider, label)`, returning metadata only.
- `keys.list(input)`: return metadata for a user, ordered by `updatedAt` descending and then `createdAt` descending.
- `keys.get(input)`: return proxy-wrapped `{ apiKey }` credentials or `null`.
- `keys.delete(input)`: delete by `userId` and `keyId`; deletion is idempotent at the public API layer.

`@ai-sdk-byok/supabase` exposes `supabaseAdapter(options)`.

`@ai-sdk-byok/cloudflare` exposes `d1Adapter(options)` and `kvCredentialCache(options)`.

`@ai-sdk-byok/drizzle` exposes `drizzleAdapter(options)` and the Postgres schema export `aiSdkByokKeys`.

Provider names are opaque application-defined strings. Omitted labels normalize to `default`. `keyHint` is the final up-to-four characters of the API key.

## Validation Requirements

Validation happens in the core manager before storage adapter calls. Failures throw `AiSdkByokValidationError`.

- `userId`: non-empty string, max 256 characters.
- `provider`: non-empty string, max 128 characters.
- `label`: non-empty string, max 128 characters after default normalization.
- `credentials`: exactly `{ apiKey: string }`, no extra fields.
- `apiKey`: non-empty string, max 8192 characters.
- All validated string fields reject ASCII control characters (U+0000–U+001F, U+007F).

## Security Invariants

- `save` and `list` must never return plaintext credentials.
- Public metadata must never expose `vault_secret_id` or equivalent storage-secret identifiers.
- Plaintext credentials may be returned only by explicit `keys.get` calls.
- Returned credentials must be proxy-wrapped so object-level string coercion and `JSON.stringify` do not leak secrets.
- Do not log, serialize, or return credentials from routes, actions, components, tests, or examples.
- Supabase secret keys must be used only in trusted server-side code.
- Supabase credential RPC functions must remain service-role-only.
- Supabase `SECURITY DEFINER` functions must set `search_path = ''` and fully qualify database objects.
- Adapter errors must not include plaintext credentials or serialized credential input.
- Cloudflare adapter credentials must be sealed with AES-256-GCM before reaching D1 or KV; plaintext and ciphertext must never appear in metadata output or error messages.
- The Cloudflare master encryption key must decode to exactly 32 bytes, must live only in Worker secrets or Secrets Store bindings, and must never be logged or echoed in errors.
- Drizzle credentials must be encrypted with AES-256-GCM before reaching SQL; the 32-byte master key must remain outside SQL, and plaintext, ciphertext, nonce, and key material must not appear in public metadata or errors.

The package does not protect against compromised application servers, compromised Supabase secret keys, malicious trusted-server dependencies, or provider-side abuse after a credential is used.

## Architecture Constraints

- Keep credential lifecycle policy in `packages/core`.
- Keep storage-specific behavior in adapter packages.
- Storage adapters receive normalized and validated input.
- Package source must avoid Node-only top-level imports so built entrypoints stay Edge-compatible.
- Tests may use Node-specific utilities.
- Build output is ESM only.
- Runtime support is Node.js 22 or newer.

## Out Of Scope

- Multi-field credentials.
- OAuth, PKCE, refresh tokens, or provider-specific credential shapes.
- Provider API validation.
- AI SDK middleware or model wrappers.
- React component libraries.
- Browser-side credential storage or provider construction.
- Application-side cryptography beyond the sealed-credential schemes owned by `@ai-sdk-byok/cloudflare` and `@ai-sdk-byok/drizzle`.

## Development Workflow

Follow the SDD flow:

1. Confirm expected behavior in `docs/specs/001-ai-sdk-byok/requirements.md`.
2. Record or update decisions in `docs/specs/001-ai-sdk-byok/decisions.md` when behavior or operational guidance changes.
3. Break implementation into task checklist updates in `docs/specs/001-ai-sdk-byok/tasks.md` when scope changes.
4. Implement the smallest coherent slice.
5. Add or update tests before marking tasks complete.
6. Run verification commands.

Do not silently expand scope. If a request conflicts with this spec, call out the conflict and update the spec only when the product decision changes.

## Commands

```sh
npm run typecheck
npm run test
npm run build
npm run lint
npm run check
```

Use npm workspaces from the repository root. `npm run check` runs typecheck, tests, and build; run it before release-oriented changes. For focused edits, run the narrowest useful command first, then broaden verification if the change affects shared behavior.

## Commit Messages

```text
<type>(optional-scope): <description>
```

Write Conventional Commits with lowercase types such as `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `build`, or `ci`. Keep the description imperative and specific, for example: `docs: add local agent workflow`.

Use a body for spec, security, migration, or public API context. If behavior is governed by a spec, mention the matching spec or doc update in the same commit.

## Example App Expectations

- key management UI can save, list, and delete metadata-backed keys;
- plaintext credentials are retrieved only in trusted server-side code;
- provider construction happens on the server;
- browser-visible responses remain metadata-only;
- environment examples must not encourage exposing Supabase secret keys to the browser.

## Documentation Expectations

- emphasize server-side use;
- show metadata-only list and save flows;
- retrieve credentials as late as possible;
- keep returned credentials out of logs and framework return values;
- refer integrators to `docs/agent-implementation.md` for agent-led integration.

When API examples change, update the root README, package READMEs, and relevant docs together.
