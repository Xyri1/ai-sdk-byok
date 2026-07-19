# Getting Started

`ai-sdk-byok` stores your users' own AI provider API keys ("bring your own key") so your app can construct AI SDK providers with a per-user key — without building credential storage, encryption, and safety plumbing yourself.

This page explains the mental model and the minimal end-to-end flow. Once you know which storage backend you are using, continue in that adapter's guide:

- [Supabase Vault guide](guides/supabase.md) — apps on Supabase.
- [Cloudflare guide](guides/cloudflare.md) — apps on Cloudflare Workers (D1 + KV).
- [Drizzle Postgres guide](guides/drizzle.md) — apps that own a PostgreSQL database with Drizzle ORM.

## Mental model

**One manager, one storage adapter.** Your server code creates a single BYOK manager from `createByokManager({ storage })`, where `storage` comes from an adapter package. All application code talks to the manager; the adapter owns how credentials are persisted.

**Metadata and credentials are strictly separated.** Four lifecycle operations exist:

| Operation | Returns | Safe for browser-visible responses? |
| --- | --- | --- |
| `keys.save` | Metadata only | Yes |
| `keys.list` | Metadata only | Yes |
| `keys.get` / `keys.getById` | Plaintext credentials (proxy-wrapped) | **No — server-side only** |
| `keys.delete` | Nothing | Yes |

Metadata is `{ id, userId, provider, label, keyHint, createdAt, updatedAt }`. The `keyHint` is the last up-to-4 characters of the API key — enough for a user to recognize their key in a list, never enough to use it.

**Plaintext credentials appear only at the last moment.** The intended flow is: the browser picks a key `id` from a metadata list, your server route derives `userId` from its own auth/session state, calls `keys.getById({ userId, keyId })`, passes `record.credentials.apiKey` into an AI SDK provider factory, and lets the record fall out of scope. Returned credentials are proxy-wrapped: `JSON.stringify(record.credentials)` and string coercion throw instead of leaking the key.

**Provider names are yours.** `provider` is an opaque string your app defines (`'openai'`, `'anthropic'`, `'my-internal-gateway'` — anything). The library never calls providers or validates keys against them.

**Labels distinguish multiple keys per provider.** A credential is addressed by `(userId, provider, label)`. Omitting `label` uses `'default'`. Saving to an existing `(userId, provider, label)` rotates that credential in place.

**Everything is server-side.** Adapters require server-only secrets (a Supabase secret key, or a 32-byte master encryption key). Nothing from this library belongs in browser code.

## Install

Pick the adapter for your stack (each guide covers this in detail):

```sh
# Supabase Vault
npm install ai-sdk-byok @ai-sdk-byok/supabase @supabase/supabase-js

# Cloudflare Workers (D1 + KV)
npm install ai-sdk-byok @ai-sdk-byok/cloudflare

# Drizzle + PostgreSQL
npm install ai-sdk-byok @ai-sdk-byok/drizzle drizzle-orm
```

## The minimal flow

Shown here with the Supabase adapter; only the `storage` line changes per adapter.

```ts
import { createByokManager } from 'ai-sdk-byok';
import { supabaseAdapter } from '@ai-sdk-byok/supabase';
import { createClient } from '@supabase/supabase-js';

// Server-only module. The secret key must never reach browser code.
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
);

export const byok = createByokManager({
  storage: supabaseAdapter({ client: supabaseAdmin }),
});
```

Save a key the user submitted (from a form handled by a server route):

```ts
const metadata = await byok.keys.save({
  userId,                                  // from your auth/session, not the browser
  provider: 'openai',
  credentials: { apiKey: submittedApiKey },
});
// metadata: { id, userId, provider, label: 'default', keyHint, createdAt, updatedAt }
```

List keys for a settings page (metadata only — safe to send to the browser):

```ts
const keys = await byok.keys.list({ userId });
```

Use a key the user selected, as late as possible, inside the route that needs it:

```ts
import { streamText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';

const record = await byok.keys.getById({ userId, keyId: selectedKeyId });

if (!record) {
  throw new Error('Selected key was not found');
}

// Trust record.provider (stored server-side), never a browser-sent provider value.
if (record.provider !== 'openai') {
  throw new Error('Choose an OpenAI key');
}

const openai = createOpenAI({ apiKey: record.credentials.apiKey });
const result = streamText({ model: openai('gpt-5'), messages });
```

Delete a key:

```ts
await byok.keys.delete({ userId, keyId });  // idempotent
```

## Next steps

- Follow your adapter's full guide: [Supabase](guides/supabase.md), [Cloudflare](guides/cloudflare.md), or [Drizzle](guides/drizzle.md). Each covers migrations, secrets, wiring the four flows into routes, verification, and operations.
- Read the [security guide](security.md) — the rules your integration must uphold.
- Consult the [API reference](reference/api.md) for every export, option, and error type.
- Optional read-path caching for `getById`: [credential caching guide](guides/caching.md).
- Integrating with a coding agent? Point it at the [agent implementation guide](agent-implementation.md).

## Requirements

- Node.js 22 or newer (or Cloudflare Workers for the Cloudflare adapter).
- ESM imports only; all packages ship ESM entrypoints that are Edge-compatible.
- TypeScript recommended; all inputs and outputs are fully typed.
