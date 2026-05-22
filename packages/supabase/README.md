# @ai-sdk-byok/supabase

Supabase Vault storage adapter for `ai-sdk-byok`.

```ts
import { createByokManager } from 'ai-sdk-byok';
import { supabaseAdapter } from '@ai-sdk-byok/supabase';

const byok = createByokManager({
  storage: supabaseAdapter({ client: supabaseAdmin }),
});
```

Apply the Supabase migrations in this package before using this adapter.

The Supabase adapter is the first concrete durable storage adapter for `keys.getById({ userId, keyId })`. Its key-id lookup checks both the selected metadata id and the trusted server-side user id, then returns metadata plus credentials for provider construction.

Optional credential caching belongs in the app or core `cachedStorage` composition layer, not this package. Redis-style caches are opt-in trusted secret infrastructure and do not replace Supabase Vault as durable storage.

Documentation:

- [Repository README](https://github.com/Xyri1/ai-sdk-byok#readme)
- [Quickstart](https://github.com/Xyri1/ai-sdk-byok/blob/master/docs/quickstart.md)
- [Supabase migrations](https://github.com/Xyri1/ai-sdk-byok/tree/master/packages/supabase/migrations)
