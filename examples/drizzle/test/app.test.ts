import { describe, expect, it } from 'vitest';
import type { DrizzleAdapterOptions } from '@ai-sdk-byok/drizzle';
import { createFakeDrizzle } from '../../../packages/drizzle/test-helpers/fake-db.js';
import { createApp } from '../src/app';
import { createManager, type ByokManager } from '../src/byok';
import { memoryEndpointStore } from './helpers/memory-endpoints';

const MASTER_KEY = Buffer.from(new Uint8Array(32).fill(7)).toString('base64');

function harness() {
  const database = createFakeDrizzle();
  const manager = createManager({
    db: database as unknown as DrizzleAdapterOptions['db'],
    masterKey: MASTER_KEY,
  });
  const endpoints = memoryEndpointStore();
  const app = createApp({ manager, endpoints: endpoints.store });
  return { app, database, manager, endpoints };
}

function postKeys(app: ReturnType<typeof createApp>, body: unknown) {
  return app.request('/api/keys', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function readJson<T>(response: Response | Promise<Response>): Promise<T> {
  return (await response).json() as T;
}

describe('GET /api/keys', () => {
  it('returns metadata only', async () => {
    const { app } = harness();
    await postKeys(app, { provider: 'openai', apiKey: 'sk-test-1234' });

    const response = await app.request('/api/keys');
    expect(response.status).toBe(200);
    const keys = await readJson<Array<Record<string, unknown>>>(response);
    expect(keys).toHaveLength(1);
    expect(Object.keys(keys[0]).sort()).toEqual([
      'createdAt',
      'id',
      'keyHint',
      'label',
      'provider',
      'updatedAt',
      'userId',
    ]);
    expect(JSON.stringify(keys)).not.toContain('sk-test-1234');
  });

  it('returns a friendly 503 when the database is not ready', async () => {
    const { app, database } = harness();
    database.error = new Error('connect ECONNREFUSED 127.0.0.1:5432');

    const response = await app.request('/api/keys');
    expect(response.status).toBe(503);
    const body = await readJson<{ error: string }>(response);
    expect(body.error).toBe('Database not ready. Check DATABASE_URL and run `npm run migrate`.');
    expect(JSON.stringify(body)).not.toContain('ECONNREFUSED');
  });
});

describe('POST /api/keys', () => {
  it('rejects non-JSON bodies', async () => {
    const { app } = harness();
    const response = await app.request('/api/keys', { method: 'POST', body: 'not json' });
    expect(response.status).toBe(400);
  });

  it('rejects baseUrl for first-party providers', async () => {
    const { app } = harness();
    const response = await postKeys(app, {
      provider: 'openai',
      apiKey: 'sk-test-1234',
      baseUrl: 'https://llm.internal/v1',
    });
    expect(response.status).toBe(400);
    expect((await readJson<{ error: string }>(response)).error).toBe(
      'baseUrl is only accepted for openai-compatible keys',
    );
  });

  it.each(['', 'not-a-url', 'ftp://x.example'])(
    'rejects openai-compatible saves with invalid base URL %j',
    async (baseUrl) => {
      const { app } = harness();
      const response = await postKeys(app, { provider: 'openai-compatible', apiKey: 'sk-test-1234', baseUrl });
      expect(response.status).toBe(400);
      expect((await readJson<{ error: string }>(response)).error).toBe(
        'A valid http(s) base URL is required for openai-compatible keys',
      );
    },
  );

  it('stores the endpoint row (trailing slash stripped) for openai-compatible saves', async () => {
    const { app, endpoints } = harness();
    const response = await postKeys(app, {
      provider: 'openai-compatible',
      apiKey: 'sk-test-1234',
      baseUrl: 'https://llm.internal/v1/',
    });
    expect(response.status).toBe(201);
    const metadata = await readJson<{ id: string }>(response);
    expect(endpoints.rows.get(metadata.id)).toBe('https://llm.internal/v1');
    expect(JSON.stringify(metadata)).not.toContain('sk-test-1234');
  });

  it('returns the defined 500 when the endpoint upsert fails after the key saved', async () => {
    const database = createFakeDrizzle();
    const manager = createManager({
      db: database as unknown as DrizzleAdapterOptions['db'],
      masterKey: MASTER_KEY,
    });
    const endpoints = memoryEndpointStore();
    endpoints.store.upsert = async () => {
      throw new Error('endpoint table missing');
    };
    const app = createApp({ manager, endpoints: endpoints.store });

    const response = await postKeys(app, {
      provider: 'openai-compatible',
      apiKey: 'sk-test-1234',
      baseUrl: 'https://llm.internal/v1',
    });
    expect(response.status).toBe(500);
    expect((await readJson<{ error: string }>(response)).error).toBe(
      'Key saved but base URL was not stored. Re-save the key to fix it.',
    );
    expect(await readJson<unknown[]>(app.request('/api/keys'))).toHaveLength(1);
  });
});

describe('DELETE /api/keys/:id', () => {
  it('deletes the endpoint row before the key', async () => {
    const events: string[] = [];
    const database = createFakeDrizzle();
    const manager = createManager({
      db: database as unknown as DrizzleAdapterOptions['db'],
      masterKey: MASTER_KEY,
    });
    const endpoints = memoryEndpointStore();
    const originalDelete = endpoints.store.delete.bind(endpoints.store);
    endpoints.store.delete = async (keyId) => {
      events.push('endpoints.delete');
      await originalDelete(keyId);
    };
    const trackingManager: ByokManager = {
      ...manager,
      keys: {
        ...manager.keys,
        delete: async (input) => {
          events.push('keys.delete');
          return manager.keys.delete(input);
        },
      },
    };
    const app = createApp({ manager: trackingManager, endpoints: endpoints.store });

    const saved = await readJson<{ id: string }>(postKeys(app, {
      provider: 'openai-compatible',
      apiKey: 'sk-test-1234',
      baseUrl: 'https://llm.internal/v1',
    }));

    const response = await app.request(`/api/keys/${saved.id}`, { method: 'DELETE' });
    expect(response.status).toBe(204);
    expect(events).toEqual(['endpoints.delete', 'keys.delete']);
    expect(endpoints.rows.size).toBe(0);
    expect(await readJson<unknown[]>(app.request('/api/keys'))).toEqual([]);
  });
});
