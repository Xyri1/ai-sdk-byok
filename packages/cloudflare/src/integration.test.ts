import { afterEach, describe, expect, it } from 'vitest';
import { AiSdkByokSerializationError, cachedStorage, createByokManager } from 'ai-sdk-byok';
import { d1Adapter } from './d1-adapter.js';
import { kvCredentialCache } from './kv-cache.js';
import { createFakeD1, type FakeD1Database } from './test-helpers/d1.js';
import { createFakeKv } from './test-helpers/kv.js';

const TEST_KEY = Buffer.from(new Uint8Array(32).fill(7)).toString('base64');

let database: (FakeD1Database & { close(): void }) | null = null;

function createManager() {
  database = createFakeD1();
  const namespace = createFakeKv();
  const manager = createByokManager({
    storage: cachedStorage({
      storage: d1Adapter({ database, encryptionKey: TEST_KEY }),
      cache: kvCredentialCache({ namespace, encryptionKey: TEST_KEY }),
      ttlMs: 60_000,
    }),
  });
  return { manager, namespace };
}

afterEach(() => {
  database?.close();
  database = null;
});

describe('cloudflare adapter end to end', () => {
  it('save and list stay metadata-only', async () => {
    const { manager } = createManager();

    const metadata = await manager.keys.save({
      userId: 'user_1',
      provider: 'openai',
      credentials: { apiKey: 'sk-e2e-1234' },
    });
    const list = await manager.keys.list({ userId: 'user_1' });

    expect(metadata.keyHint).toBe('1234');
    expect(JSON.stringify(metadata)).not.toContain('sk-e2e-1234');
    expect(JSON.stringify(list)).not.toContain('sk-e2e-1234');
  });

  it('getById serves from the cache after the first read', async () => {
    const { manager } = createManager();
    const metadata = await manager.keys.save({
      userId: 'user_1',
      provider: 'openai',
      credentials: { apiKey: 'sk-e2e-1234' },
    });

    const first = await manager.keys.getById({ userId: 'user_1', keyId: metadata.id });
    expect(first?.credentials.apiKey).toBe('sk-e2e-1234');

    await database!.prepare('DELETE FROM ai_sdk_byok_keys;').run();

    const second = await manager.keys.getById({ userId: 'user_1', keyId: metadata.id });
    expect(second?.credentials.apiKey).toBe('sk-e2e-1234');
  });

  it('returned credentials resist JSON.stringify leakage', async () => {
    const { manager } = createManager();
    const metadata = await manager.keys.save({
      userId: 'user_1',
      provider: 'openai',
      credentials: { apiKey: 'sk-e2e-1234' },
    });

    const record = await manager.keys.getById({ userId: 'user_1', keyId: metadata.id });
    const credentials = await manager.keys.get({ userId: 'user_1', provider: 'openai' });

    expect(record?.credentials.apiKey).toBe('sk-e2e-1234');
    expect(credentials?.apiKey).toBe('sk-e2e-1234');
    expect(() => JSON.stringify(record)).toThrow(AiSdkByokSerializationError);
    expect(() => JSON.stringify(credentials)).toThrow(AiSdkByokSerializationError);
  });

  it('rotation invalidates the cache', async () => {
    const { manager } = createManager();
    const metadata = await manager.keys.save({
      userId: 'user_1',
      provider: 'openai',
      credentials: { apiKey: 'sk-e2e-1234' },
    });
    await manager.keys.getById({ userId: 'user_1', keyId: metadata.id });

    await manager.keys.save({
      userId: 'user_1',
      provider: 'openai',
      credentials: { apiKey: 'sk-e2e-9999' },
    });

    const record = await manager.keys.getById({ userId: 'user_1', keyId: metadata.id });
    expect(record?.credentials.apiKey).toBe('sk-e2e-9999');
  });

  it('delete clears the cache and is idempotent at the manager layer', async () => {
    const { manager, namespace } = createManager();
    const metadata = await manager.keys.save({
      userId: 'user_1',
      provider: 'openai',
      credentials: { apiKey: 'sk-e2e-1234' },
    });
    await manager.keys.getById({ userId: 'user_1', keyId: metadata.id });

    await manager.keys.delete({ userId: 'user_1', keyId: metadata.id });
    await manager.keys.delete({ userId: 'user_1', keyId: metadata.id });

    expect(namespace.entries.size).toBe(0);
    await expect(manager.keys.getById({ userId: 'user_1', keyId: metadata.id })).resolves.toBeNull();
  });
});
