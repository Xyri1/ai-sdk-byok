# Example: Next.js + Supabase

A minimal Next.js 16 demo of `ai-sdk-byok`. It lets you save provider API keys for a hard-coded demo user, list their metadata, delete them, and then use one of them to stream a chat response from the selected provider via the AI SDK.

## What the demo covers

- **Key management UI** — save, list, and delete per-provider API keys through Server Actions.
- **Chat demo** — pick a saved key, browse available models from the provider, type a prompt, and stream the response.
- **Database error state** — the app renders a setup notice if the Supabase migration has not been applied yet, rather than crashing.

## Supported providers

OpenAI, Anthropic, DeepSeek, xAI, Groq, Mistral, Cohere, OpenRouter, and any OpenAI-compatible endpoint.

## Prerequisites

- Node.js 22 or newer.
- A Supabase project with Vault enabled (available on all plans).
- A server-side Supabase secret key for the project.
- At least one provider API key to test with.

## Setup

### 1. Apply the migration

Apply the migration from the package root to your Supabase project. The easiest way is through the Supabase dashboard SQL editor:

1. Open your Supabase project → SQL editor.
2. Paste the contents of [`supabase/migrations/202605190001_ai_sdk_byok_init.sql`](../../supabase/migrations/202605190001_ai_sdk_byok_init.sql) from the repository root.
3. Run the migration.

Alternatively, use the Supabase CLI:

```sh
supabase db push --file ../../supabase/migrations/202605190001_ai_sdk_byok_init.sql
```

Or link the project and push:

```sh
supabase link --project-ref <your-project-ref>
supabase db push
```

### 2. Configure environment variables

```sh
cp .env.example .env
```

Fill in `.env`:

```sh
# Required: your Supabase project URL and server-side secret key.
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SECRET_KEY=sb_secret_...

# Optional: base URL for the OpenAI-compatible provider (e.g. Ollama, LM Studio).
OPENAI_COMPATIBLE_BASE_URL=
```

The secret key must only ever be used in server-side code. Never expose it in a browser bundle.

### 3. Install dependencies

From the repository root:

```sh
npm install
```

### 4. Build the package

The example is part of the root npm workspace and depends on the local `ai-sdk-byok` and `@ai-sdk-byok/supabase` workspace packages. Make sure the packages are built before running the dev server:

```sh
# from the repository root
npm run build
```

### 5. Start the dev server

```sh
# from examples/nextjs-supabase
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Using the demo

### Save a key

1. Choose a provider from the dropdown.
2. Paste your API key.
3. Optionally set a label (defaults to `default`).
4. Click **Save key**.

The saved key appears in the list as metadata only — no plaintext key is shown.

### Chat

1. Choose a saved key from the dropdown in the Chat section.
2. The model list loads automatically from the provider's models endpoint.
3. Select a model.
4. Type a prompt and click **Send**.

### Delete a key

Click **Delete** next to any saved key in the list. The row is removed and the associated Vault secret is cleaned up by a database trigger.

## Notes

- The demo hardcodes `userId = 'demo-user'` in [`lib/demo-user.ts`](lib/demo-user.ts). This is intentional for a local demo; a real application would use the authenticated user's ID.
- The OpenAI-compatible provider requires `OPENAI_COMPATIBLE_BASE_URL` to be set for both model listing and chat.
- The dev server runs with `--webpack` because the example targets Next.js 16 and uses local workspace package dependencies.
