import { beforeEach, describe, expect, it } from 'vitest';
import type { DrizzleAdapterOptions } from '@ai-sdk-byok/drizzle';
import { createFakeDrizzle } from '../../../packages/drizzle/test-helpers/fake-db.js';
import { createManager } from '../src/byok';

const MASTER_KEY = Buffer.from(new Uint8Array(32).fill(7)).toString('base64');

function fakeDb(): DrizzleAdapterOptions['db'] {
  return createFakeDrizzle() as unknown as DrizzleAdapterOptions['db'];
}

describe('createManager', () => {
  beforeEach(() => {
    delete process.env.BYOK_REDIS_REST_URL;
    delete process.env.BYOK_REDIS_REST_TOKEN;
  });

  it('round-trips a key through save, list, and getById without leaking secrets', async () => {
    const byok = createManager({ db: fakeDb(), masterKey: MASTER_KEY });

    const metadata = await byok.keys.save({
      userId: 'demo-user',
      provider: 'openai',
      credentials: { apiKey: 'sk-test-1234' },
    });

    expect(Object.keys(metadata).sort()).toEqual([
      'createdAt',
      'id',
      'keyHint',
      'label',
      'provider',
      'updatedAt',
      'userId',
    ]);

    const listed = await byok.keys.list({ userId: 'demo-user' });
    expect(listed).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain('sk-test-1234');

    const record = await byok.keys.getById({ userId: 'demo-user', keyId: metadata.id });
    expect(record?.credentials.apiKey).toBe('sk-test-1234');
  });

  it('rejects a master key that does not decode to 32 bytes', () => {
    expect(() => createManager({ db: fakeDb(), masterKey: Buffer.from('too-short').toString('base64') })).toThrow(
      /32 bytes/,
    );
  });
});
