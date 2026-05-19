# Integration Testing Notes

Use a disposable Supabase project or development branch for migration validation. Do not run these checks against production unless you intend to install the BYOK schema there.

## Prerequisites

- Supabase Vault is available and enabled.
- A server-side Supabase key with `service_role` privileges is available only in local environment variables.
- The migration in `supabase/migrations/202605190001_ai_sdk_byok_init.sql` has been reviewed for the target project.

## Suggested Setup

1. Create a Supabase development branch or disposable project.
2. Apply `supabase/migrations/202605190001_ai_sdk_byok_init.sql`.
3. Initialize a server-side client with the project URL and secret key.
4. Create a manager with `createByokManager({ storage: supabaseAdapter({ client }) })`.
5. Exercise the lifecycle with a throwaway credential:
   - `keys.save({ userId, provider, credentials: { apiKey } })`
   - `keys.list({ userId })`
   - `keys.get({ userId, provider })`
   - `keys.delete({ userId, keyId })`

## Expected Results

- `save` returns metadata only and no plaintext credential.
- `list` returns metadata ordered by latest update and never includes `vault_secret_id`.
- `get` returns the original `{ apiKey }` for the matching `(userId, provider, label)`.
- `delete` removes the metadata row and cleanup removes the Vault secret.
- Calls made with browser `anon` or `authenticated` roles cannot read metadata or execute credential RPC functions.

## Cleanup

Delete the development branch or disposable project after validation. If testing in a shared project, delete all rows for the test `userId` and confirm no matching Vault secret remains.
