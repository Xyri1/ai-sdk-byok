import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiSdkByokAdapterError, AiSdkByokValidationError } from 'ai-sdk-byok';
import { d1Adapter } from './d1-adapter.js';
import { createFakeD1, type FakeD1Database } from './test-helpers/d1.js';

const TEST_KEY = Buffer.from(new Uint8Array(32).fill(7)).toString('base64');

const saveInput = {
  userId: 'user_1',
  provider: 'openai',
  label: 'default',
  credentials: { apiKey: 'sk-test-1234' },
  keyHint: '1234',
};

let database: (FakeD1Database & { close(): void }) | null = null;

function createAdapter() {
  database = createFakeD1();
  return d1Adapter({ database, encryptionKey: TEST_KEY });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-17T00:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
  database?.close();
  database = null;
});

describe('d1Adapter', () => {
  it('rejects a wrong-length encryption key at construction', () => {
    expect(() => d1Adapter({ database: {}, encryptionKey: 'dG9vLXNob3J0' })).toThrow(AiSdkByokValidationError);
  });

  it('saves sealed credentials and returns metadata only', async () => {
    const adapter = createAdapter();

    const metadata = await adapter.save(saveInput);

    expect(metadata).toEqual({
      id: expect.any(String),
      userId: 'user_1',
      provider: 'openai',
      label: 'default',
      keyHint: '1234',
      createdAt: '2026-07-17T00:00:00.000Z',
      updatedAt: '2026-07-17T00:00:00.000Z',
    });
    expect(JSON.stringify(metadata)).not.toContain('sk-test-1234');

    const stored = await database!
      .prepare('SELECT credentials_ciphertext FROM ai_sdk_byok_keys;')
      .first<{ credentials_ciphertext: string }>();
    expect(stored?.credentials_ciphertext.startsWith('v1.')).toBe(true);
    expect(stored?.credentials_ciphertext).not.toContain('sk-test-1234');
  });

  it('rotation preserves id and createdAt while updating hint and updatedAt', async () => {
    const adapter = createAdapter();
    const original = await adapter.save(saveInput);

    vi.setSystemTime(new Date('2026-07-18T00:00:00.000Z'));
    const rotated = await adapter.save({ ...saveInput, credentials: { apiKey: 'sk-test-9999' }, keyHint: '9999' });

    expect(rotated.id).toBe(original.id);
    expect(rotated.createdAt).toBe('2026-07-17T00:00:00.000Z');
    expect(rotated.updatedAt).toBe('2026-07-18T00:00:00.000Z');
    expect(rotated.keyHint).toBe('9999');
    await expect(adapter.get(saveInput)).resolves.toEqual({ apiKey: 'sk-test-9999' });
  });

  it('lists metadata ordered by updatedAt then createdAt descending, without ciphertext', async () => {
    const adapter = createAdapter();
    await adapter.save(saveInput);
    vi.setSystemTime(new Date('2026-07-18T00:00:00.000Z'));
    await adapter.save({ ...saveInput, provider: 'anthropic', keyHint: '5678' });

    const list = await adapter.list({ userId: 'user_1' });

    expect(list.map((entry) => entry.provider)).toEqual(['anthropic', 'openai']);
    for (const entry of list) {
      expect(entry).not.toHaveProperty('credentials_ciphertext');
      expect(entry).not.toHaveProperty('credentials');
    }
  });

  it('get returns credentials on hit and null on miss', async () => {
    const adapter = createAdapter();
    await adapter.save(saveInput);

    await expect(adapter.get(saveInput)).resolves.toEqual({ apiKey: 'sk-test-1234' });
    await expect(adapter.get({ ...saveInput, provider: 'missing' })).resolves.toBeNull();
  });

  it('rejects ciphertext moved to a different slot (AAD binding)', async () => {
    const adapter = createAdapter();
    await adapter.save(saveInput);
    await adapter.save({ ...saveInput, userId: 'user_2', credentials: { apiKey: 'sk-victim-0000' }, keyHint: '0000' });

    const victim = await database!
      .prepare('SELECT credentials_ciphertext FROM ai_sdk_byok_keys WHERE user_id = ?;')
      .bind('user_2')
      .first<{ credentials_ciphertext: string }>();
    await database!
      .prepare('UPDATE ai_sdk_byok_keys SET credentials_ciphertext = ? WHERE user_id = ?;')
      .bind(victim!.credentials_ciphertext, 'user_1')
      .run();

    await expect(adapter.get(saveInput)).rejects.toThrow(AiSdkByokAdapterError);
  });

  it('getById returns the full record for the owner and null otherwise', async () => {
    const adapter = createAdapter();
    const metadata = await adapter.save(saveInput);

    const record = await adapter.getById({ userId: 'user_1', keyId: metadata.id });
    expect(record?.credentials).toEqual({ apiKey: 'sk-test-1234' });
    expect(record?.id).toBe(metadata.id);

    await expect(adapter.getById({ userId: 'user_2', keyId: metadata.id })).resolves.toBeNull();
  });

  it('delete removes the row and is idempotent', async () => {
    const adapter = createAdapter();
    const metadata = await adapter.save(saveInput);

    await adapter.delete({ userId: 'user_1', keyId: metadata.id });
    await adapter.delete({ userId: 'user_1', keyId: metadata.id });

    await expect(adapter.get(saveInput)).resolves.toBeNull();
  });

  it('wraps database failures in AiSdkByokAdapterError without credential input', async () => {
    const broken = {
      prepare() {
        throw new Error('boom');
      },
    };
    const adapter = d1Adapter({ database: broken, encryptionKey: TEST_KEY });

    const failure = await adapter.save(saveInput).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AiSdkByokAdapterError);
    expect((failure as Error).message).toBe('Cloudflare D1 BYOK adapter failed during save');
    expect((failure as Error).message).not.toContain('sk-test-1234');
  });
});
