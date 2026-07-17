import { inspect } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import { cachedStorage } from './cached-storage.js';
import { createByokManager } from './manager.js';
import { AiSdkByokSerializationError, AiSdkByokValidationError } from './errors.js';
import type { CredentialRecordCache } from './cached-storage.js';
import type { ByokStorageAdapter, StoredKeyCredentialRecord } from './types.js';

const storedRecord: StoredKeyCredentialRecord = {
  id: 'key_1',
  userId: 'user_1',
  provider: 'openai',
  label: 'default',
  keyHint: '1234',
  createdAt: '2026-05-19T00:00:00.000Z',
  updatedAt: '2026-05-19T00:00:00.000Z',
  credentials: { apiKey: 'sk-test-1234' },
};

function createStorage(): ByokStorageAdapter {
  return {
    save: vi.fn(async (input) => ({
      id: 'key_1',
      userId: input.userId,
      provider: input.provider,
      label: input.label,
      keyHint: input.keyHint,
      createdAt: '2026-05-19T00:00:00.000Z',
      updatedAt: '2026-05-19T00:00:00.000Z',
    })),
    list: vi.fn(async () => []),
    get: vi.fn(async () => ({ apiKey: 'sk-test-1234' })),
    getById: vi.fn(async () => storedRecord),
    delete: vi.fn(async () => undefined),
  };
}

function createCache(): CredentialRecordCache {
  return {
    get: vi.fn(async () => null),
    set: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
  };
}

describe('createByokManager', () => {
  it('normalizes omitted labels and derives key hints before save', async () => {
    const storage = createStorage();
    const byok = createByokManager({ storage });

    await byok.keys.save({
      userId: 'user_1',
      provider: 'openai',
      credentials: { apiKey: 'sk-test-1234' },
    });

    expect(storage.save).toHaveBeenCalledWith({
      userId: 'user_1',
      provider: 'openai',
      label: 'default',
      credentials: { apiKey: 'sk-test-1234' },
      keyHint: '1234',
    });
  });

  it('preserves custom labels and derives short key hints before save', async () => {
    const storage = createStorage();
    const byok = createByokManager({ storage });

    await byok.keys.save({
      userId: 'user_1',
      provider: 'anthropic',
      label: 'work',
      credentials: { apiKey: 'sk' },
    });

    expect(storage.save).toHaveBeenCalledWith({
      userId: 'user_1',
      provider: 'anthropic',
      label: 'work',
      credentials: { apiKey: 'sk' },
      keyHint: 'sk',
    });
  });

  it('rejects invalid save input before storage calls', async () => {
    const symbolCredential = { apiKey: 'sk-test', [Symbol('extra')]: true };
    const nonEnumerableCredential = { apiKey: 'sk-test' };
    Object.defineProperty(nonEnumerableCredential, 'extra', {
      enumerable: false,
      value: true,
    });

    const invalidInputs = [
      null,
      { userId: '', provider: 'openai', credentials: { apiKey: 'sk-test' } },
      { userId: 'user_1', provider: '', credentials: { apiKey: 'sk-test' } },
      { userId: 'user_1', provider: 'openai', label: '', credentials: { apiKey: 'sk-test' } },
      { userId: 'user_1', provider: 'openai', credentials: { apiKey: '' } },
      { userId: 'user_1', provider: 'openai', credentials: { apiKey: 'sk-test', extra: true } },
      { userId: 'user_1', provider: 'openai', credentials: symbolCredential },
      { userId: 'user_1', provider: 'openai', credentials: nonEnumerableCredential },
      { userId: 'u'.repeat(257), provider: 'openai', credentials: { apiKey: 'sk-test' } },
      { userId: 'user_1', provider: 'p'.repeat(129), credentials: { apiKey: 'sk-test' } },
      { userId: 'user_1', provider: 'openai', label: 'l'.repeat(129), credentials: { apiKey: 'sk-test' } },
      { userId: 'user_1', provider: 'openai', credentials: { apiKey: 'k'.repeat(8193) } },
      { userId: 'user\u00001', provider: 'openai', credentials: { apiKey: 'sk-test' } },
      { userId: 'user_1', provider: 'open\u0000ai', credentials: { apiKey: 'sk-test' } },
      { userId: 'user_1', provider: 'openai', label: 'a\u0000b', credentials: { apiKey: 'sk-test' } },
      { userId: 'user_1', provider: 'open\u0007ai', credentials: { apiKey: 'sk-test' } },
      { userId: 'user_1', provider: 'open\u007fai', credentials: { apiKey: 'sk-test' } },
      { userId: 'user_1', provider: 'openai', credentials: { apiKey: 'sk-\u0000test' } },
    ];

    for (const input of invalidInputs) {
      const storage = createStorage();
      const byok = createByokManager({ storage });

      await expect(byok.keys.save(input as never)).rejects.toBeInstanceOf(AiSdkByokValidationError);

      expect(storage.save).not.toHaveBeenCalled();
    }
  });

  it('rejects invalid list, get, and delete input before storage calls', async () => {
    const storage = createStorage();
    const byok = createByokManager({ storage });

    await expect(byok.keys.list(null as never)).rejects.toBeInstanceOf(AiSdkByokValidationError);
    await expect(byok.keys.get(null as never)).rejects.toBeInstanceOf(AiSdkByokValidationError);
    await expect(byok.keys.getById(null as never)).rejects.toBeInstanceOf(AiSdkByokValidationError);
    await expect(byok.keys.delete(null as never)).rejects.toBeInstanceOf(AiSdkByokValidationError);
    await expect(byok.keys.list({ userId: ' ' })).rejects.toBeInstanceOf(AiSdkByokValidationError);
    await expect(byok.keys.get({ userId: 'user_1', provider: ' ' })).rejects.toBeInstanceOf(
      AiSdkByokValidationError,
    );
    await expect(byok.keys.getById({ userId: 'user_1', keyId: '' })).rejects.toBeInstanceOf(
      AiSdkByokValidationError,
    );
    await expect(byok.keys.getById({ userId: 'user_1', keyId: 'k'.repeat(129) })).rejects.toBeInstanceOf(
      AiSdkByokValidationError,
    );
    await expect(byok.keys.getById({ userId: 'user_1', keyId: 'key\u00001' })).rejects.toBeInstanceOf(
      AiSdkByokValidationError,
    );
    await expect(byok.keys.delete({ userId: 'user\u00001', keyId: 'key_1' })).rejects.toBeInstanceOf(
      AiSdkByokValidationError,
    );
    await expect(byok.keys.delete({ userId: 'user_1', keyId: '' })).rejects.toBeInstanceOf(
      AiSdkByokValidationError,
    );

    expect(storage.list).not.toHaveBeenCalled();
    expect(storage.get).not.toHaveBeenCalled();
    expect(storage.getById).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('returns null from get when storage returns null', async () => {
    const storage = createStorage();
    vi.mocked(storage.get).mockResolvedValueOnce(null);
    const byok = createByokManager({ storage });

    await expect(byok.keys.get({ userId: 'user_1', provider: 'openai' })).resolves.toBeNull();
  });

  it('protects credentials returned from get', async () => {
    const byok = createByokManager({ storage: createStorage() });
    const credentials = await byok.keys.get({ userId: 'user_1', provider: 'openai' });

    if (credentials === null) {
      throw new Error('Expected protected credentials');
    }

    expect(credentials.apiKey).toBe('sk-test-1234');
    expect(Object.isFrozen(credentials)).toBe(true);
    expect(() => JSON.stringify(credentials)).toThrow(AiSdkByokSerializationError);
    expect(() => String(credentials)).toThrow(AiSdkByokSerializationError);
    expect(() => Reflect.get(credentials, 'toJSON')()).toThrow(AiSdkByokSerializationError);
    expect(() => Reflect.get(credentials, Symbol.toPrimitive)()).toThrow(AiSdkByokSerializationError);
    expect(() => {
      credentials.apiKey = 'sk-mutated';
    }).toThrow(TypeError);
    expect(inspect(credentials)).toBe('[ApiKeyCredentials redacted]');
  });

  it('returns null from getById when storage returns null', async () => {
    const storage = createStorage();
    vi.mocked(storage.getById).mockResolvedValueOnce(null);
    const byok = createByokManager({ storage });

    await expect(byok.keys.getById({ userId: 'user_1', keyId: 'key_1' })).resolves.toBeNull();
  });

  it('protects credentials returned inside getById records', async () => {
    const byok = createByokManager({ storage: createStorage() });
    const record = await byok.keys.getById({ userId: 'user_1', keyId: 'key_1' });

    if (record === null) {
      throw new Error('Expected protected credential record');
    }

    expect(record).toMatchObject({
      id: 'key_1',
      userId: 'user_1',
      provider: 'openai',
      label: 'default',
      keyHint: '1234',
    });
    expect(record.credentials.apiKey).toBe('sk-test-1234');
    expect(Object.isFrozen(record.credentials)).toBe(true);
    expect(() => JSON.stringify(record)).toThrow(AiSdkByokSerializationError);
    expect(() => String(record.credentials)).toThrow(AiSdkByokSerializationError);
    expect(() => {
      record.credentials.apiKey = 'sk-mutated';
    }).toThrow(TypeError);
  });
});

describe('cachedStorage', () => {
  it('requires an explicit positive ttl', () => {
    const storage = createStorage();
    const cache = createCache();

    expect(() => cachedStorage({ storage, cache, ttlMs: 0 })).toThrow(AiSdkByokValidationError);
    expect(() => cachedStorage({ storage, cache, ttlMs: Number.NaN })).toThrow(AiSdkByokValidationError);
  });

  it('returns getById cache hits without storage reads', async () => {
    const storage = createStorage();
    const cache = createCache();
    vi.mocked(cache.get).mockResolvedValueOnce(storedRecord);
    const wrapped = cachedStorage({ storage, cache, ttlMs: 30_000 });

    await expect(wrapped.getById({ userId: 'user_1', keyId: 'key_1' })).resolves.toBe(storedRecord);

    expect(cache.get).toHaveBeenCalledWith({ userId: 'user_1', keyId: 'key_1' });
    expect(storage.getById).not.toHaveBeenCalled();
  });

  it('lets the manager protect cached getById records before public return', async () => {
    const storage = createStorage();
    const cache = createCache();
    vi.mocked(cache.get).mockResolvedValueOnce(storedRecord);
    const byok = createByokManager({ storage: cachedStorage({ storage, cache, ttlMs: 30_000 }) });

    const record = await byok.keys.getById({ userId: 'user_1', keyId: 'key_1' });

    if (record === null) {
      throw new Error('Expected protected cached record');
    }

    expect(record.credentials.apiKey).toBe('sk-test-1234');
    expect(() => JSON.stringify(record)).toThrow(AiSdkByokSerializationError);
    expect(storage.getById).not.toHaveBeenCalled();
  });

  it('populates getById cache misses from storage fallback', async () => {
    const storage = createStorage();
    const cache = createCache();
    const wrapped = cachedStorage({ storage, cache, ttlMs: 45_000 });

    await expect(wrapped.getById({ userId: 'user_1', keyId: 'key_1' })).resolves.toBe(storedRecord);

    expect(storage.getById).toHaveBeenCalledWith({ userId: 'user_1', keyId: 'key_1' });
    expect(cache.set).toHaveBeenCalledWith({ userId: 'user_1', keyId: 'key_1' }, storedRecord, {
      ttlMs: 45_000,
    });
  });

  it('falls back to storage when getById cache reads fail', async () => {
    const storage = createStorage();
    const cache = createCache();
    vi.mocked(cache.get).mockRejectedValueOnce(new Error('cache unavailable'));
    const wrapped = cachedStorage({ storage, cache, ttlMs: 30_000 });

    await expect(wrapped.getById({ userId: 'user_1', keyId: 'key_1' })).resolves.toBe(storedRecord);

    expect(storage.getById).toHaveBeenCalledWith({ userId: 'user_1', keyId: 'key_1' });
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('ignores cache population failures on getById read paths', async () => {
    const storage = createStorage();
    const cache = createCache();
    vi.mocked(cache.set).mockRejectedValueOnce(new Error('cache unavailable'));
    const wrapped = cachedStorage({ storage, cache, ttlMs: 30_000 });

    await expect(wrapped.getById({ userId: 'user_1', keyId: 'key_1' })).resolves.toBe(storedRecord);
  });

  it('invalidates after save using returned normalized metadata', async () => {
    const storage = createStorage();
    const cache = createCache();
    vi.mocked(storage.save).mockResolvedValueOnce({
      id: 'stored_key',
      userId: 'normalized_user',
      provider: 'openai',
      label: 'default',
      keyHint: '1234',
      createdAt: '2026-05-19T00:00:00.000Z',
      updatedAt: '2026-05-19T00:00:00.000Z',
    });
    const wrapped = cachedStorage({ storage, cache, ttlMs: 30_000 });

    await wrapped.save({
      userId: 'input_user',
      provider: 'openai',
      label: 'default',
      credentials: { apiKey: 'sk-test-1234' },
      keyHint: '1234',
    });

    expect(cache.delete).toHaveBeenCalledWith({ userId: 'normalized_user', keyId: 'stored_key' });
  });

  it('invalidates before and after delete storage calls', async () => {
    const storage = createStorage();
    const cache = createCache();
    const events: string[] = [];
    vi.mocked(cache.delete).mockImplementation(async () => {
      events.push('cache.delete');
    });
    vi.mocked(storage.delete).mockImplementation(async () => {
      events.push('storage.delete');
    });
    const wrapped = cachedStorage({ storage, cache, ttlMs: 30_000 });

    await wrapped.delete({ userId: 'user_1', keyId: 'key_1' });

    expect(events).toEqual(['cache.delete', 'storage.delete', 'cache.delete']);
    expect(cache.delete).toHaveBeenNthCalledWith(1, { userId: 'user_1', keyId: 'key_1' });
    expect(cache.delete).toHaveBeenNthCalledWith(2, { userId: 'user_1', keyId: 'key_1' });
  });

  it('fails closed when save invalidation fails after storage mutation', async () => {
    const storage = createStorage();
    const cache = createCache();
    vi.mocked(cache.delete).mockRejectedValueOnce(new Error('cache unavailable'));
    const wrapped = cachedStorage({ storage, cache, ttlMs: 30_000 });

    await expect(
      wrapped.save({
        userId: 'user_1',
        provider: 'openai',
        label: 'default',
        credentials: { apiKey: 'sk-test-1234' },
        keyHint: '1234',
      }),
    ).rejects.toThrow('cache unavailable');
    expect(storage.save).toHaveBeenCalled();
  });

  it('fails closed when delete invalidation fails before storage mutation', async () => {
    const storage = createStorage();
    const cache = createCache();
    vi.mocked(cache.delete).mockRejectedValueOnce(new Error('cache unavailable'));
    const wrapped = cachedStorage({ storage, cache, ttlMs: 30_000 });

    await expect(wrapped.delete({ userId: 'user_1', keyId: 'key_1' })).rejects.toThrow('cache unavailable');
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('fails closed when delete invalidation fails after storage mutation', async () => {
    const storage = createStorage();
    const cache = createCache();
    vi.mocked(cache.delete)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('cache unavailable'));
    const wrapped = cachedStorage({ storage, cache, ttlMs: 30_000 });

    await expect(wrapped.delete({ userId: 'user_1', keyId: 'key_1' })).rejects.toThrow('cache unavailable');
    expect(storage.delete).toHaveBeenCalled();
  });
});
