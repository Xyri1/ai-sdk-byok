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

Documentation:

- [Repository README](https://github.com/Xyri1/ai-sdk-byok#readme)
- [Quickstart](https://github.com/Xyri1/ai-sdk-byok/blob/master/docs/quickstart.md)
- [Supabase migrations](https://github.com/Xyri1/ai-sdk-byok/tree/master/packages/supabase/migrations)
