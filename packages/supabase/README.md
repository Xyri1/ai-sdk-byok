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
