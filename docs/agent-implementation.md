# Agent Implementation Guide

Use this guide when integrating `ai-sdk-byok` into an existing application.

Before editing files, run the compatibility check. If the target app does not meet every required condition, stop and report the incompatibility instead of attempting a partial integration.

## Compatibility Check

Required:

- The app uses TypeScript.
- The app has trusted server-side code where secrets can be used.
- The app uses Supabase.
- The Supabase project can enable and use Vault.
- The app can run the SQL migrations in `supabase/migrations`.
- The app can install `ai-sdk-byok`, `@ai-sdk-byok/supabase`, and `@supabase/supabase-js`.
- User-owned provider credentials can be represented as single-field `{ apiKey: string }` objects.
- AI provider instances are constructed on the server, not in browser code.

Unsupported for now:

- Non-Supabase storage backends.
- Browser-side credential storage or provider construction.
- Multi-field credentials, OAuth tokens, refresh tokens, or provider-specific credential shapes.
- Apps that cannot run Supabase RPC migrations.
- Apps that require returning plaintext credentials to clients.

## Stop Conditions

Stop before making changes if:

- The app does not use Supabase, or the user does not want to add Supabase.
- Supabase Vault is unavailable or cannot be enabled.
- There is no trusted server-side runtime for storing and retrieving credentials.
- The app requires credential shapes other than `{ apiKey: string }`.
- The requested integration would expose the Supabase secret key, Vault secret IDs, or plaintext provider API keys to browser code.
- You cannot identify where authenticated user IDs come from.

When stopping, explain which condition failed and what would need to change before `ai-sdk-byok` can be integrated.

## Implementation Steps

1. Inspect the app structure, package manager, framework, auth flow, existing AI SDK usage, and Supabase setup.
2. Install the packages:

   ```sh
   npm install ai-sdk-byok @ai-sdk-byok/supabase @supabase/supabase-js
   ```

3. Apply all SQL migrations from `supabase/migrations` in order to the target Supabase project.
4. Add server-only environment variables for the Supabase project URL and secret key. Do not expose the secret key to the browser.
5. Create a server-only BYOK manager:

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

6. Add server-side save, list, and delete flows for the authenticated user's provider keys.
7. Retrieve credentials only when constructing an AI SDK provider, then let the credentials fall out of scope. Prefer `getById` when a user selected a metadata row from `keys.list()`:

   ```ts
   import { createOpenAI } from '@ai-sdk/openai';

   const record = await byok.keys.getById({
     userId,
     keyId: selectedKeyId,
   });

   if (!record || record.provider !== 'openai') {
     throw new Error('Choose an OpenAI key');
   }

   const openai = createOpenAI({ apiKey: record.credentials.apiKey });
   ```

8. Keep list responses metadata-only. Client Components may pass key metadata ids, but server routes must derive `userId` from trusted auth/session state and use returned metadata for provider selection.
9. Add or update tests for the new server-side flows.
10. Run the project's verification commands.

Optional: wrap storage with `cachedStorage` only when the app owns a server-only credential cache. Redis-style cache values include plaintext credentials, require explicit TTLs, and are not a first-party adapter package. Do not cache metadata/list responses as part of this integration.

## Security Rules

- Use the Supabase secret key only in trusted server-side code.
- Never log, serialize, or return credentials.
- Never pass plaintext credentials into Client Components or browser-visible payloads.
- Store only `{ apiKey: string }` credentials.
- Use `keys.getById` or `keys.get` as late as possible, only when constructing a provider.
- Treat Supabase credential RPC functions as service-role-only operations.
- Treat Redis or any other credential cache as trusted secret infrastructure and never expose it to browser code.

## Useful References

- [Quickstart](quickstart.md)
- [Architecture](architecture.md)
- [Threat model](threat-model.md)
- [Next.js + Supabase example](../examples/nextjs-supabase/README.md)
