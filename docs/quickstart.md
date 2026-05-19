# Quickstart

## 1. Apply the Supabase Migration

Apply the SQL in `supabase/migrations/202605190001_ai_sdk_byok_init.sql` to a Supabase project with Vault enabled.

## 2. Create a Server-Side Manager

```ts
import { createByokManager } from 'ai-sdk-byok';
import { supabaseAdapter } from 'ai-sdk-byok/supabase';
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

const credentials = await byok.keys.get({ userId, provider: 'openai' });

if (!credentials) {
  throw new Error('No OpenAI key configured');
}

const openai = createOpenAI({ apiKey: credentials.apiKey });

const result = streamText({
  model: openai('gpt-5'),
  messages,
});
```

Retrieve credentials as late as possible and let them fall out of scope after provider construction.
