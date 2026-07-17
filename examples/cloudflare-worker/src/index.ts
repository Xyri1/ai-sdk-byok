import { createOpenAI } from '@ai-sdk/openai';
import { AiSdkByokValidationError, cachedStorage, createByokManager } from 'ai-sdk-byok';
import { d1Adapter, kvCredentialCache } from '@ai-sdk-byok/cloudflare';
import { generateText } from 'ai';
import { Hono } from 'hono';

export interface Env {
  DB: D1Database;
  BYOK_CACHE: KVNamespace;
  BYOK_MASTER_KEY: string;
}

// Demo identity. In a real app derive the user id from your session
// layer (e.g. better-auth) — never from browser-provided input.
const DEMO_USER_ID = 'demo-user';
const MODEL_ID = 'gpt-5-mini';

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
  const body = await c.req.json<{ provider?: string; label?: string; apiKey?: string }>();

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

app.post('/api/chat', async (c) => {
  const body = await c.req.json<{ keyId?: string; prompt?: string }>();

  if (!body.keyId || !body.prompt) {
    return c.json({ error: 'keyId and prompt are required' }, 400);
  }

  const record = await createManager(c.env).keys.getById({ userId: DEMO_USER_ID, keyId: body.keyId });

  if (record === null) {
    return c.json({ error: 'No stored key for this id' }, 404);
  }

  if (record.provider !== 'openai') {
    return c.json({ error: 'This example only wires the openai provider' }, 400);
  }

  // The plaintext credential never leaves this handler; the browser gets model text only.
  const openai = createOpenAI({ apiKey: record.credentials.apiKey });
  const result = await generateText({ model: openai.chat(MODEL_ID), prompt: body.prompt });

  return c.json({ text: result.text });
});

export default app;
