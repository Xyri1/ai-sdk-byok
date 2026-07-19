# @ai-sdk-byok/supabase

Supabase Vault storage adapter for [`ai-sdk-byok`](https://www.npmjs.com/package/ai-sdk-byok). Plaintext keys live only inside Vault; your app talks to service-role-only RPC functions through a server-side Supabase client.

## Install

```sh
npm install ai-sdk-byok @ai-sdk-byok/supabase @supabase/supabase-js
```

## Setup

1. Apply the three SQL migrations shipped in this package (`node_modules/@ai-sdk-byok/supabase/migrations/`) to your project in filename order — via the dashboard SQL editor, `psql`, or the Supabase CLI.
2. Create the manager in trusted server-side code with a **secret key** client:

```ts
import { createByokManager } from 'ai-sdk-byok';
import { supabaseAdapter } from '@ai-sdk-byok/supabase';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,   // server-only; never in browser bundles
);

export const byok = createByokManager({
  storage: supabaseAdapter({ client: supabaseAdmin }),
});
```

Then use `byok.keys.save / list / get / getById / delete` — see the guide below for wiring the flows into routes.

## Security model

- The metadata table never contains plaintext keys; Vault encrypts inside the database boundary.
- Credential RPC functions are executable only by `service_role`; browser `anon`/`authenticated` roles can read nothing.
- The Vault secret ID is never exposed through the public API, and deleting a key removes the Vault secret.

## Documentation

- [Supabase integration guide](https://github.com/Xyri1/ai-sdk-byok/blob/master/docs/guides/supabase.md) — full walkthrough: migrations, secrets, route wiring, verification
- [API reference](https://github.com/Xyri1/ai-sdk-byok/blob/master/docs/reference/api.md)
- [Security guide](https://github.com/Xyri1/ai-sdk-byok/blob/master/docs/security.md)
- [Next.js + Supabase example](https://github.com/Xyri1/ai-sdk-byok/tree/master/examples/nextjs-supabase)
