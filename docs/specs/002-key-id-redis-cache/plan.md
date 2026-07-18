# Implementation Plan

## Architecture

This scope extends the v0.1 architecture without changing its default safety model.

- The core manager adds key-id based retrieval and keeps validation/proxy behavior centralized.
- The core storage contract adds key-id based retrieval so cache behavior is adapter-agnostic.
- The Supabase adapter is the first concrete adapter to add a credential retrieval path by `{ userId, keyId }`.
- Supabase SQL adds a service-role-only RPC that checks both metadata id and user id before reading Vault.
- Optional credential caching uses a generic cache interface, composes around storage behavior, and remains disabled by default.

## API Shape

```ts
const record = await byok.keys.getById({
  userId,
  keyId,
});
```

`userId` must come from trusted server-side authentication or session state. `keyId` may come from browser-visible metadata, but it is never sufficient by itself.

`getById` returns a public `KeyCredentialRecord`:

```ts
const record = await byok.keys.getById({ userId, keyId });

if (!record) {
  throw new Error('No key configured');
}

const model = createModel(record.metadata.provider, record.credentials.apiKey, requestedModel);
```

Server routes must use returned metadata for provider selection. They must not trust browser-provided provider values when routing plaintext credentials to provider APIs.

`keys.get({ userId, provider, label })` keeps its existing return shape of proxy-wrapped `{ apiKey }` credentials or `null`.

## Cache Shape

```ts
const byok = createByokManager({
  storage: cachedStorage({
    storage: supabaseAdapter({ client: supabaseAdmin }),
    cache,
    ttlSeconds: 60,
  }),
});
```

The cache wrapper depends on the core storage contract, not Supabase-specific behavior. This scope defines a generic cache interface; Redis is one possible app-provided backend.

The core package exports the generic cache wrapper as `cachedStorage`.

The generic cache interface stores internal serializable `StoredKeyCredentialRecord` values, not public proxy-wrapped `KeyCredentialRecord` values. `cachedStorage` operates below the manager and does not proxy-wrap credentials. The manager creates the public proxy-wrapped record after the cache wrapper or storage adapter returns `StoredKeyCredentialRecord`.

The required logical operations are:

- read credential records by `{ userId, keyId }`;
- write credential records by `{ userId, keyId }` with TTL;
- delete credential records by `{ userId, keyId }`.

## Example App Shape

The Next.js Supabase example should move its credential-touching server routes from label-based lookup to key-id based lookup.

```ts
const record = await byok.keys.getById({
  userId: demoUserId,
  keyId,
});
```

The browser may continue to send the selected metadata id. The route must still derive `userId` from trusted server-side context, read provider information from returned metadata, and keep plaintext credentials out of Client Components and responses.

If the optional cache is demonstrated in the example, it should be configured in server-only code and guarded by environment variables so the default example remains Supabase-only.

The example's Redis wiring is app-owned code using the generic cache interface. It does not imply a first-party Redis client adapter package.

## Milestones

- Milestone 1: Add `getById` types, validation, manager behavior, and core tests.
- Milestone 2: Add Supabase SQL/RPC and adapter support for key-id retrieval.
- Milestone 3: Update example server routes and example docs to use `getById` for selected metadata ids.
- Milestone 4: Define and implement optional cache wrapper behavior.
- Milestone 5: Add documentation and threat-model updates for credential caching with Redis-style backends.

## Verification

- Run focused core and Supabase adapter tests while implementing each milestone.
- Run the example app checks after updating routes.
- Run `npm run test` after the API and adapter are complete.
- Run `npm run check` before release-oriented changes.
- Verify package entrypoints remain ESM and Edge-compatible.
