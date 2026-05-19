import { inspect } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import { createByokManager } from './manager.js';
import { AiSdkByokSerializationError, AiSdkByokValidationError } from './errors.js';
import type { ByokStorageAdapter } from './types.js';

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
    await expect(byok.keys.delete(null as never)).rejects.toBeInstanceOf(AiSdkByokValidationError);
    await expect(byok.keys.list({ userId: ' ' })).rejects.toBeInstanceOf(AiSdkByokValidationError);
    await expect(byok.keys.get({ userId: 'user_1', provider: ' ' })).rejects.toBeInstanceOf(
      AiSdkByokValidationError,
    );
    await expect(byok.keys.delete({ userId: 'user_1', keyId: '' })).rejects.toBeInstanceOf(
      AiSdkByokValidationError,
    );

    expect(storage.list).not.toHaveBeenCalled();
    expect(storage.get).not.toHaveBeenCalled();
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
});
