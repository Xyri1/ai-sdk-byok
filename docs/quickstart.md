# Quickstart

## 1. Apply the Supabase Migration

Apply the SQL files in `packages/supabase/migrations` in order to a Supabase project with Vault enabled.

## 2. Create a Server-Side Manager

```ts
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

The Supabase secret key must only be used in trusted server-side code. Supabase secret keys are the current replacement for legacy `service_role` API keys.

## 3. Save a User Key

```ts
await byok.keys.save({
  userId,
  provider: 'openai',
  credentials: { apiKey },
});
```

Omitting `label` stores the credential under `default`.

## 4. Construct an AI SDK Provider

```ts
import { streamText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';

const record = await byok.keys.getById({ userId, keyId: selectedKeyId });

if (!record) {
  throw new Error('Selected key was not found');
}

if (record.provider !== 'openai') {
  throw new Error('Choose an OpenAI key');
}

const openai = createOpenAI({ apiKey: record.credentials.apiKey });

const result = streamText({
  model: openai('gpt-5'),
  messages,
});
```

Retrieve credentials as late as possible and let them fall out of scope after provider construction.
`selectedKeyId` may come from browser-visible metadata, but `userId` must come from trusted server-side auth/session state. Use `record.provider` for provider selection instead of trusting a provider value sent by the browser. Label-oriented integrations can still use `keys.get({ userId, provider, label })`.

## Optional Credential Cache

For lower-latency key-id retrieval, apps may wrap storage with `cachedStorage` and an app-owned cache backend:

```ts
import { cachedStorage, createByokManager } from 'ai-sdk-byok';

export const byok = createByokManager({
  storage: cachedStorage({
    storage: supabaseAdapter({ client: supabaseAdmin }),
    cache: appCredentialCache,
    ttlMs: 60_000,
  }),
});
```

The cache interface is generic and adapter-agnostic; Supabase is only the first concrete durable adapter. Cache values include plaintext credentials, so Redis-style backends must be server-only trusted secret infrastructure. Use trusted server-side `userId` plus `keyId` for cache keys, short TTLs such as 30–120 seconds, and rely on save/delete invalidation. Metadata/list caching is out of scope.
