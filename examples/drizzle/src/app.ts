import { AiSdkByokAdapterError, AiSdkByokValidationError } from 'ai-sdk-byok';
import { streamText } from 'ai';
import { Hono } from 'hono';
import type { ByokManager } from './byok';
import type { EndpointStore } from './endpoints';
import { createModel, getModelEndpoint, isSupportedProvider, normalizeModels } from './providers';

// Demo identity. In a real app derive the user id from your session
// layer (e.g. better-auth) — never from browser-provided input.
export const DEMO_USER_ID = 'demo-user';

export interface AppDeps {
  manager: ByokManager;
  endpoints: EndpointStore;
}

const DB_NOT_READY = 'Database not ready. Check DATABASE_URL and run `npm run migrate`.';
const NO_BASE_URL = 'No base URL configured for this key. Re-save the key with a base URL.';

function normalizeBaseUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) {
    return null;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }
  } catch {
    return null;
  }
  return value.replace(/\/+$/, '');
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();

  app.get('/api/keys', async (c) => {
    try {
      const keys = await deps.manager.keys.list({ userId: DEMO_USER_ID });
      return c.json(keys);
    } catch (error) {
      if (error instanceof AiSdkByokAdapterError) {
        return c.json({ error: DB_NOT_READY }, 503);
      }
      throw error;
    }
  });

  app.post('/api/keys', async (c) => {
    let body: { provider?: string; label?: string; apiKey?: string; baseUrl?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'request body must be valid JSON' }, 400);
    }

    const provider = body.provider ?? '';

    if (body.baseUrl !== undefined && provider !== 'openai-compatible') {
      return c.json({ error: 'baseUrl is only accepted for openai-compatible keys' }, 400);
    }

    let baseUrl: string | null = null;
    if (provider === 'openai-compatible') {
      baseUrl = normalizeBaseUrl(body.baseUrl);
      if (baseUrl === null) {
        return c.json({ error: 'A valid http(s) base URL is required for openai-compatible keys' }, 400);
      }
    }

    let metadata;
    try {
      metadata = await deps.manager.keys.save({
        userId: DEMO_USER_ID,
        provider,
        ...(body.label ? { label: body.label } : {}),
        credentials: { apiKey: body.apiKey ?? '' },
      });
    } catch (error) {
      if (error instanceof AiSdkByokValidationError) {
        return c.json({ error: error.message }, 400);
      }
      if (error instanceof AiSdkByokAdapterError) {
        return c.json({ error: DB_NOT_READY }, 503);
      }
      throw error;
    }

    if (baseUrl !== null) {
      try {
        await deps.endpoints.upsert(metadata.id, baseUrl);
      } catch {
        return c.json({ error: 'Key saved but base URL was not stored. Re-save the key to fix it.' }, 500);
      }
    }

    return c.json(metadata, 201);
  });

  app.delete('/api/keys/:id', async (c) => {
    const keyId = c.req.param('id');
    // Endpoint row first: a mid-sequence failure leaves an orphan endpoint
    // row (harmless), never a key that can no longer resolve its base URL.
    await deps.endpoints.delete(keyId);
    await deps.manager.keys.delete({ userId: DEMO_USER_ID, keyId });
    return c.body(null, 204);
  });

  app.get('/api/models', async (c) => {
    const keyId = c.req.query('keyId') ?? '';
    if (!keyId) {
      return c.json({ error: 'keyId is required' }, 400);
    }

    const record = await deps.manager.keys.getById({ userId: DEMO_USER_ID, keyId });
    if (record === null) {
      return c.json({ error: 'No stored key for this id' }, 404);
    }
    if (!isSupportedProvider(record.provider)) {
      return c.json({ error: 'Choose a supported provider key' }, 400);
    }

    let baseUrl: string | undefined;
    if (record.provider === 'openai-compatible') {
      const stored = await deps.endpoints.get(record.id);
      if (stored === null) {
        return c.json({ error: NO_BASE_URL }, 409);
      }
      baseUrl = stored;
    }

    try {
      const endpoint = getModelEndpoint(record.provider, record.credentials.apiKey, baseUrl);
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
    let body: { keyId?: string; model?: string; prompt?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'request body must be valid JSON' }, 400);
    }

    if (!body.keyId || !body.model || !body.prompt) {
      return c.json({ error: 'keyId, model, and prompt are required' }, 400);
    }

    const record = await deps.manager.keys.getById({ userId: DEMO_USER_ID, keyId: body.keyId });
    if (record === null) {
      return c.json({ error: 'No stored key for this id' }, 404);
    }
    if (!isSupportedProvider(record.provider)) {
      return c.json({ error: 'Choose a supported provider key' }, 400);
    }

    let baseUrl: string | undefined;
    if (record.provider === 'openai-compatible') {
      const stored = await deps.endpoints.get(record.id);
      if (stored === null) {
        return c.json({ error: NO_BASE_URL }, 409);
      }
      baseUrl = stored;
    }

    try {
      // The plaintext credential never leaves this handler; the browser gets model text only.
      const model = createModel(record.provider, record.credentials.apiKey, body.model, baseUrl);
      const result = streamText({ model, prompt: body.prompt });

      return result.toTextStreamResponse();
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : 'The chat request could not be completed' },
        400,
      );
    }
  });

  return app;
}
