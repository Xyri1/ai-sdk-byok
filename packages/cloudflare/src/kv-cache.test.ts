import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import { AiSdkByokAdapterError, type StoredKeyCredentialRecord } from 'ai-sdk-byok';
import { kvCredentialCache } from './kv-cache.js';
import { createFakeKv } from './test-helpers/kv.js';

const TEST_KEY = Buffer.from(new Uint8Array(32).fill(7)).toString('base64');
const OTHER_KEY = Buffer.from(new Uint8Array(32).fill(9)).toString('base64');

const record: StoredKeyCredentialRecord = {
  id: 'key_1',
  userId: 'user_1',
  provider: 'openai',
  label: 'default',
  keyHint: '1234',
  createdAt: '2026-07-17T00:00:00.000Z',
  updatedAt: '2026-07-17T00:00:00.000Z',
  credentials: { apiKey: 'sk-test-1234' },
};

const slot = { userId: 'user_1', keyId: 'key_1' };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-17T00:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('kvCredentialCache', () => {
  it('round-trips a record and stores only sealed values under hashed keys', async () => {
    const namespace = createFakeKv();
    const cache = kvCredentialCache({ namespace, encryptionKey: TEST_KEY });

    await cache.set(slot, record, { ttlMs: 300_000 });

    expect(namespace.entries.size).toBe(1);
    const [key, entry] = [...namespace.entries][0]!;
    expect(key).toMatch(/^ai-sdk-byok:[0-9a-f]{64}$/);
    expect(key).not.toContain('user_1');
    expect(entry.value.startsWith('v1.')).toBe(true);
    expect(entry.value).not.toContain('sk-test-1234');
    expect(entry.expirationTtl).toBe(300);

    await expect(cache.get(slot)).resolves.toEqual(record);
  });

  it('honors a custom key prefix', async () => {
    const namespace = createFakeKv();
    const cache = kvCredentialCache({ namespace, encryptionKey: TEST_KEY, keyPrefix: 'custom:' });

    await cache.set(slot, record, { ttlMs: 120_000 });

    expect([...namespace.entries.keys()][0]).toMatch(/^custom:[0-9a-f]{64}$/);
  });

  it('clamps physical expirationTtl to the KV 60-second floor', async () => {
    const namespace = createFakeKv();
    const cache = kvCredentialCache({ namespace, encryptionKey: TEST_KEY });

    await cache.set(slot, record, { ttlMs: 15_000 });

    expect([...namespace.entries.values()][0]!.expirationTtl).toBe(60);
  });

  it('enforces logical expiry below the physical floor', async () => {
    const namespace = createFakeKv();
    const cache = kvCredentialCache({ namespace, encryptionKey: TEST_KEY });
    await cache.set(slot, record, { ttlMs: 15_000 });

    vi.setSystemTime(new Date('2026-07-17T00:00:20.000Z'));

    await expect(cache.get(slot)).resolves.toBeNull();
    expect(namespace.entries.size).toBe(0);
  });

  it('treats undecryptable entries as misses and evicts them', async () => {
    const namespace = createFakeKv();
    await kvCredentialCache({ namespace, encryptionKey: OTHER_KEY }).set(slot, record, { ttlMs: 300_000 });

    const cache = kvCredentialCache({ namespace, encryptionKey: TEST_KEY });

    await expect(cache.get(slot)).resolves.toBeNull();
    expect(namespace.entries.size).toBe(0);
  });

  it('rejects entries replayed under a different slot (AAD binding)', async () => {
    const namespace = createFakeKv();
    const cache = kvCredentialCache({ namespace, encryptionKey: TEST_KEY });
    await cache.set(slot, record, { ttlMs: 300_000 });
    const sealed = [...namespace.entries.values()][0]!.value;

    const otherSlot = { userId: 'user_2', keyId: 'key_1' };
    const otherCache = kvCredentialCache({ namespace, encryptionKey: TEST_KEY });
    await otherCache.set(otherSlot, { ...record, userId: 'user_2' }, { ttlMs: 300_000 });
    const otherKey = [...namespace.entries.keys()].find((key) => namespace.entries.get(key)!.value !== sealed)!;
    namespace.entries.set(otherKey, { value: sealed, expirationTtl: 300 });

    await expect(otherCache.get(otherSlot)).resolves.toBeNull();
  });

  it('deletes entries', async () => {
    const namespace = createFakeKv();
    const cache = kvCredentialCache({ namespace, encryptionKey: TEST_KEY });
    await cache.set(slot, record, { ttlMs: 300_000 });

    await cache.delete(slot);

    expect(namespace.entries.size).toBe(0);
    await expect(cache.get(slot)).resolves.toBeNull();
  });

  it('wraps namespace failures in AiSdkByokAdapterError', async () => {
    const cache = kvCredentialCache({
      namespace: {
        async get() {
          throw new Error('kv down');
        },
        async put() {
          throw new Error('kv down');
        },
        async delete() {
          throw new Error('kv down');
        },
      },
      encryptionKey: TEST_KEY,
    });

    await expect(cache.get(slot)).rejects.toThrow(AiSdkByokAdapterError);
    await expect(cache.set(slot, record, { ttlMs: 60_000 })).rejects.toThrow(AiSdkByokAdapterError);
    await expect(cache.delete(slot)).rejects.toThrow(AiSdkByokAdapterError);
  });
});
