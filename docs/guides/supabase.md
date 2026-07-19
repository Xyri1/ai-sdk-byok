# Integration Guide: Supabase Vault

Store user API keys in Supabase Vault. Encryption and decryption happen inside the database boundary; your app talks to service-role-only RPC functions through a server-side Supabase client.

New to the library? Read [Getting Started](../getting-started.md) first for the mental model.

## 1. Prerequisites

Confirm every item before starting:

- [ ] A Supabase project with **Vault** enabled (available on all plans).
- [ ] A server-side **secret key** for the project (Project Settings → API keys; secret keys are the replacement for legacy `service_role` keys). It must live only in server-side environment variables.
- [ ] Node.js 22 or newer, ESM, TypeScript recommended.
- [ ] Trusted server-side code (route handlers, server actions, API routes) where secrets can be used — this library has no browser-side role.
- [ ] User credentials representable as a single `{ apiKey: string }` field.

## 2. Install

```sh
npm install ai-sdk-byok @ai-sdk-byok/supabase @supabase/supabase-js
```

`@supabase/supabase-js` is a peer dependency of the adapter.

## 3. Apply the migrations

The adapter requires three SQL migrations, shipped in the package at `node_modules/@ai-sdk-byok/supabase/migrations/`:

1. `202605190001_ai_sdk_byok_init.sql`
2. `202605190002_ai_sdk_byok_save_returns_metadata.sql`
3. `202605190003_ai_sdk_byok_get_credentials_by_id.sql`

Apply them **in filename order** using any one of:

**Supabase dashboard** — open SQL Editor, paste each file's contents in order, run each.

**psql** — with your project's connection string:

```sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f node_modules/@ai-sdk-byok/supabase/migrations/202605190001_ai_sdk_byok_init.sql \
  -f node_modules/@ai-sdk-byok/supabase/migrations/202605190002_ai_sdk_byok_save_returns_metadata.sql \
  -f node_modules/@ai-sdk-byok/supabase/migrations/202605190003_ai_sdk_byok_get_credentials_by_id.sql
```

**Supabase CLI** — copy the files into your project's `supabase/migrations/` directory (keeping their timestamp prefixes) and run `supabase db push`.

The migrations create the `public.ai_sdk_byok_keys` metadata table and `SECURITY DEFINER` RPC functions (`ai_sdk_byok_save_credentials`, `ai_sdk_byok_get_credentials`, `ai_sdk_byok_get_credentials_by_id`, `ai_sdk_byok_delete_credentials`) that are executable **only by `service_role`**. Plaintext keys live only in Vault secrets, never in the metadata table.

**Verify:** in the SQL editor, `select * from public.ai_sdk_byok_keys;` succeeds (empty result), and the four `ai_sdk_byok_*` functions appear under Database → Functions.

## 4. Configure secrets

Server-side environment variables only:

```sh
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SECRET_KEY=sb_secret_...
```

Never expose the secret key to browser code, client bundles, or `NEXT_PUBLIC_`-style variables. The browser-facing `anon`/`publishable` key cannot read BYOK metadata or execute the credential RPCs — that is by design; all BYOK traffic goes through your server.

## 5. Create the manager

One server-only module, imported by every route that needs keys:

```ts
// lib/byok.ts — server-only
import { createByokManager } from 'ai-sdk-byok';
import { supabaseAdapter } from '@ai-sdk-byok/supabase';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
);

export const byok = createByokManager({
  storage: supabaseAdapter({ client: supabaseAdmin }),
});
```

In Next.js, add `import 'server-only';` at the top to make accidental client imports a build error.

## 6. Wire the four flows

All handlers derive `userId` from your auth/session state — never from a browser-supplied value. Examples below use Next.js route handlers; the same shape applies to server actions or any framework's server routes.

**Save (and rotate):**

```ts
// app/api/keys/route.ts
import { byok } from '@/lib/byok';
import { getSessionUserId } from '@/lib/auth';

export async function POST(request: Request) {
  const userId = await getSessionUserId();          // trusted
  const { provider, label, apiKey } = await request.json();

  const metadata = await byok.keys.save({
    userId,
    provider,
    label,                                          // optional; defaults to 'default'
    credentials: { apiKey },
  });

  return Response.json(metadata);                   // metadata only — safe
}
```

Saving again with the same `(userId, provider, label)` rotates the stored key in place.

**List:**

```ts
export async function GET() {
  const userId = await getSessionUserId();
  const keys = await byok.keys.list({ userId });    // metadata only, newest first
  return Response.json(keys);
}
```

**Delete:**

```ts
export async function DELETE(request: Request) {
  const userId = await getSessionUserId();
  const { keyId } = await request.json();
  await byok.keys.delete({ userId, keyId });        // idempotent
  return Response.json({ ok: true });
}
```

**Use a key (chat route):** retrieve credentials as late as possible, inside the handler that constructs the provider:

```ts
// app/api/chat/route.ts
import { streamText, convertToModelMessages } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { byok } from '@/lib/byok';
import { getSessionUserId } from '@/lib/auth';

export async function POST(request: Request) {
  const userId = await getSessionUserId();
  const { keyId, messages } = await request.json(); // keyId came from keys.list metadata

  const record = await byok.keys.getById({ userId, keyId });

  if (!record) {
    return new Response('Selected key was not found', { status: 404 });
  }

  // Select the provider from stored metadata, not from browser input.
  if (record.provider !== 'openai') {
    return new Response('Choose an OpenAI key', { status: 400 });
  }

  const openai = createOpenAI({ apiKey: record.credentials.apiKey });

  const result = streamText({
    model: openai('gpt-5'),
    messages: convertToModelMessages(messages),
  });

  return result.toUIMessageStreamResponse();
}
```

Do not log `record`, put it in error reports, or return it from the handler. `JSON.stringify(record.credentials)` throws by design.

Apps that address keys by provider rather than id can use `keys.get({ userId, provider, label })` instead of `getById`.

## 7. Verify

Smoke-test from a throwaway server-side script or route, with a disposable credential:

```ts
const meta = await byok.keys.save({
  userId: 'smoke-test-user',
  provider: 'openai',
  credentials: { apiKey: 'sk-test-1234' },
});

const listed = await byok.keys.list({ userId: 'smoke-test-user' });
// expect: one entry, keyHint '1234', no credential fields anywhere

const record = await byok.keys.getById({ userId: 'smoke-test-user', keyId: meta.id });
// expect: record.credentials.apiKey === 'sk-test-1234'

await byok.keys.delete({ userId: 'smoke-test-user', keyId: meta.id });
// expect: keys.list returns []
```

Also confirm isolation: a Supabase client created with the browser `anon`/`publishable` key must fail to select from `ai_sdk_byok_keys` and to execute the `ai_sdk_byok_*` RPC functions. For a fuller checklist against a disposable project, see [integration testing notes](../development/integration-testing.md).

## 8. Operational notes

- **Vault does the crypto.** There is no master key to manage in your app; protect the Supabase secret key instead, and rotate it via the Supabase dashboard if it leaks.
- **Deletion cleans up Vault.** Deleting a key removes both the metadata row and the underlying Vault secret. The Vault secret ID is never exposed through the public API.
- **RPC functions are service-role-only.** Keep it that way — do not grant execute to `anon` or `authenticated`, and do not proxy the RPCs to browsers.
- **Optional caching:** for lower-latency `getById`, wrap the adapter with `cachedStorage` and an app-owned server-only cache — see the [caching guide](caching.md).
- **Runnable example:** [examples/nextjs-supabase](../../examples/nextjs-supabase/README.md) — key management UI, streaming chat across nine providers, and optional Redis cache wiring.

Further reading: [security guide](../security.md) · [API reference](../reference/api.md) · [threat model](../development/threat-model.md)
