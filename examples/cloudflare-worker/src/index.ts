import { AiSdkByokValidationError, cachedStorage, createByokManager } from 'ai-sdk-byok';
import { d1Adapter, kvCredentialCache } from '@ai-sdk-byok/cloudflare';
import { streamText } from 'ai';
import { Hono } from 'hono';
import { createModel, getModelEndpoint, isSupportedProvider, normalizeModels } from './providers';

export interface Env {
  DB: D1Database;
  BYOK_CACHE: KVNamespace;
  BYOK_MASTER_KEY: string;
  OPENAI_COMPATIBLE_BASE_URL?: string;
}

// Demo identity. In a real app derive the user id from your session
// layer (e.g. better-auth) — never from browser-provided input.
const DEMO_USER_ID = 'demo-user';

function createManager(env: Env) {
  return createByokManager({
    storage: cachedStorage({
      storage: d1Adapter({ database: env.DB, encryptionKey: env.BYOK_MASTER_KEY }),
      cache: kvCredentialCache({ namespace: env.BYOK_CACHE, encryptionKey: env.BYOK_MASTER_KEY }),
      ttlMs: 60_000,
    }),
  });
}

const app = new Hono<{ Bindings: Env }>();

app.get('/api/keys', async (c) => {
  const keys = await createManager(c.env).keys.list({ userId: DEMO_USER_ID });
  return c.json(keys);
});

app.post('/api/keys', async (c) => {
  let body: { provider?: string; label?: string; apiKey?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'request body must be valid JSON' }, 400);
  }

  try {
    const metadata = await createManager(c.env).keys.save({
      userId: DEMO_USER_ID,
      provider: body.provider ?? '',
      ...(body.label ? { label: body.label } : {}),
      credentials: { apiKey: body.apiKey ?? '' },
    });
    return c.json(metadata, 201);
  } catch (error) {
    if (error instanceof AiSdkByokValidationError) {
      return c.json({ error: error.message }, 400);
    }
    throw error;
  }
});

app.delete('/api/keys/:id', async (c) => {
  await createManager(c.env).keys.delete({ userId: DEMO_USER_ID, keyId: c.req.param('id') });
  return c.body(null, 204);
});

app.get('/api/models', async (c) => {
  const keyId = c.req.query('keyId') ?? '';

  if (!keyId) {
    return c.json({ error: 'keyId is required' }, 400);
  }

  const record = await createManager(c.env).keys.getById({ userId: DEMO_USER_ID, keyId });

  if (record === null) {
    return c.json({ error: 'No stored key for this id' }, 404);
  }

  if (!isSupportedProvider(record.provider)) {
    return c.json({ error: 'Choose a supported provider key' }, 400);
  }

  try {
    const endpoint = getModelEndpoint(record.provider, record.credentials.apiKey, c.env.OPENAI_COMPATIBLE_BASE_URL);
    const response = await fetch(endpoint.url, { headers: endpoint.headers });

    if (!response.ok) {
      return c.json({ error: `${endpoint.providerLabel} models could not be loaded` }, 502);
    }

    return c.json({ models: normalizeModels(await response.json()) });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Models could not be loaded' }, 400);
  }
});

app.post('/api/chat', async (c) => {
  const body = await c.req.json<{ keyId?: string; model?: string; prompt?: string }>();

  if (!body.keyId || !body.model || !body.prompt) {
    return c.json({ error: 'keyId, model, and prompt are required' }, 400);
  }

  const record = await createManager(c.env).keys.getById({ userId: DEMO_USER_ID, keyId: body.keyId });

  if (record === null) {
    return c.json({ error: 'No stored key for this id' }, 404);
  }

  if (!isSupportedProvider(record.provider)) {
    return c.json({ error: 'Choose a supported provider key' }, 400);
  }

  try {
    // The plaintext credential never leaves this handler; the browser gets model text only.
    const model = createModel(record.provider, record.credentials.apiKey, body.model, c.env.OPENAI_COMPATIBLE_BASE_URL);
    const result = streamText({ model, prompt: body.prompt });

    return result.toTextStreamResponse();
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : 'The chat request could not be completed' },
      400,
    );
  }
});

export default app;
