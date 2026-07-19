import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DrizzleAdapterOptions } from '@ai-sdk-byok/drizzle';
import { createFakeDrizzle } from '../../../packages/drizzle/test-helpers/fake-db.js';
import { createApp } from '../src/app';
import { createManager } from '../src/byok';
import { memoryEndpointStore } from './helpers/memory-endpoints';

const MASTER_KEY = Buffer.from(new Uint8Array(32).fill(7)).toString('base64');
const NO_BASE_URL = 'No base URL configured for this key. Re-save the key with a base URL.';

function harness() {
  const database = createFakeDrizzle();
  const manager = createManager({
    db: database as unknown as DrizzleAdapterOptions['db'],
    masterKey: MASTER_KEY,
  });
  const endpoints = memoryEndpointStore();
  const app = createApp({ manager, endpoints: endpoints.store });
  return { app, endpoints };
}

async function saveKey(
  app: ReturnType<typeof createApp>,
  body: Record<string, unknown>,
): Promise<{ id: string }> {
  const response = await app.request('/api/keys', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (await response.json()) as { id: string };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GET /api/models', () => {
  it('requires keyId', async () => {
    const { app } = harness();
    const response = await app.request('/api/models');
    expect(response.status).toBe(400);
  });

  it('returns 404 for an unknown key', async () => {
    const { app } = harness();
    const response = await app.request('/api/models?keyId=missing');
    expect(response.status).toBe(404);
  });

  it('returns 409 for an openai-compatible key with no endpoint row', async () => {
    const { app, endpoints } = harness();
    const saved = await saveKey(app, {
      provider: 'openai-compatible',
      apiKey: 'sk-test-1234',
      baseUrl: 'https://llm.internal/v1',
    });
    endpoints.rows.clear();

    const response = await app.request(`/api/models?keyId=${saved.id}`);
    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: string }).error).toBe(NO_BASE_URL);
  });

  it('lists models from the stored base URL', async () => {
    const { app } = harness();
    const saved = await saveKey(app, {
      provider: 'openai-compatible',
      apiKey: 'sk-test-1234',
      baseUrl: 'https://llm.internal/v1',
    });

    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ id: 'model-b' }, { id: 'model-a' }] }), {
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const response = await app.request(`/api/models?keyId=${saved.id}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      models: [
        { id: 'model-a', name: 'model-a' },
        { id: 'model-b', name: 'model-b' },
      ],
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://llm.internal/v1/models',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer sk-test-1234' }) }),
    );
  });
});

describe('POST /api/chat', () => {
  it('requires keyId, model, and prompt', async () => {
    const { app } = harness();
    const response = await app.request('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-test' }),
    });
    expect(response.status).toBe(400);
  });

  it('returns 409 for an openai-compatible key with no endpoint row', async () => {
    const { app, endpoints } = harness();
    const saved = await saveKey(app, {
      provider: 'openai-compatible',
      apiKey: 'sk-test-1234',
      baseUrl: 'https://llm.internal/v1',
    });
    endpoints.rows.clear();

    const response = await app.request('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ keyId: saved.id, model: 'some-model', prompt: 'hello' }),
    });
    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: string }).error).toBe(NO_BASE_URL);
  });
});
