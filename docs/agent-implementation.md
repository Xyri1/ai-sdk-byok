# Agent Implementation Guide

Use this guide when integrating `ai-sdk-byok` into an existing application. Choose the Supabase Vault path for Supabase projects or the Drizzle/PostgreSQL path for applications that already own a Drizzle database.

Before editing files, run the compatibility check. If the target app does not meet every required condition, stop and report the incompatibility instead of attempting a partial integration.

## Compatibility Check

Required:

- The app uses TypeScript.
- The app has trusted server-side code where secrets can be used.
- The app uses Supabase with Vault, or PostgreSQL with Drizzle ORM.
- The app can run the selected adapter's SQL migration.
- The app can install the selected adapter and its peer dependency.
- User-owned provider credentials can be represented as single-field `{ apiKey: string }` objects.
- AI provider instances are constructed on the server, not in browser code.

Unsupported for now:

- Storage backends other than Supabase Vault or Drizzle PostgreSQL.
- Browser-side credential storage or provider construction.
- Multi-field credentials, OAuth tokens, refresh tokens, or provider-specific credential shapes.
- Apps that cannot run the selected adapter's database migration.
- Apps that require returning plaintext credentials to clients.

## Stop Conditions

Stop before making changes if:

- The app has neither an available Supabase Vault project nor a PostgreSQL Drizzle database.
- There is no trusted server-side runtime for storing and retrieving credentials.
- The app requires credential shapes other than `{ apiKey: string }`.
- The requested integration would expose adapter secret material, Vault secret IDs, or plaintext provider API keys to browser code.
- You cannot identify where authenticated user IDs come from.

When stopping, explain which condition failed and what would need to change before `ai-sdk-byok` can be integrated.

## Implementation Steps

1. Inspect the app structure, package manager, framework, auth flow, existing AI SDK usage, and selected database setup.
2. Install the packages for the selected adapter:

   ```sh
   # Supabase Vault
   npm install ai-sdk-byok @ai-sdk-byok/supabase @supabase/supabase-js

   # Drizzle + PostgreSQL
   npm install ai-sdk-byok @ai-sdk-byok/drizzle drizzle-orm
   ```

3. Apply the selected migration: all SQL files from `packages/supabase/migrations` for Supabase, or `packages/drizzle/migrations/0001_ai_sdk_byok_init.sql` for Drizzle PostgreSQL. Drizzle Kit users may generate the equivalent migration from the exported schema.
4. Add server-only secrets. Supabase uses the project URL and secret key; Drizzle uses a 32-byte base64 master key. Never expose either adapter's secret material to the browser.
5. Create a server-only BYOK manager. For Supabase:

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

   For Drizzle PostgreSQL:

   ```ts
   import { createByokManager } from 'ai-sdk-byok';
   import { drizzleAdapter } from '@ai-sdk-byok/drizzle';

   export const byok = createByokManager({
     storage: drizzleAdapter({
       db,
       dialect: 'postgres',
       encryption: {
         current: { version: 'v1', key: process.env.AI_SDK_BYOK_MASTER_KEY! },
       },
     }),
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

- Use the Supabase secret key only in trusted server-side code when using Supabase.
- Keep the Drizzle master key outside SQL and use it only in trusted server-side code.
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
- [Drizzle + Postgres example](../examples/drizzle/README.md)
