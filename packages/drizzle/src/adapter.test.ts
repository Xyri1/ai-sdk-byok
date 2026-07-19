import {
  AiSdkByokAdapterError,
  AiSdkByokValidationError,
  createByokManager,
  type KeyMetadata,
} from 'ai-sdk-byok';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EncryptionConfig } from './crypto.js';
import { drizzleAdapter, type DrizzleAdapterOptions } from './adapter.js';
import { createFakeDrizzle, type FakeDrizzleDatabase, type FakeDrizzleRow } from '../test-helpers/fake-db.js';

const V1_KEY = Buffer.from(new Uint8Array(32).fill(1)).toString('base64');
const V2_KEY = Buffer.from(new Uint8Array(32).fill(2)).toString('base64');
const API_KEY = 'sk-test-1234';

const saveInput = {
  userId: 'user_1',
  provider: 'openai',
  label: 'default',
  credentials: { apiKey: API_KEY },
  keyHint: '1234',
};

const keyMetadataKeys: (keyof KeyMetadata)[] = [
  'id',
  'userId',
  'provider',
  'label',
  'keyHint',
  'createdAt',
  'updatedAt',
];

function encryption(version: 'v1' | 'v2' = 'v1', previous?: EncryptionConfig['previous']): EncryptionConfig {
  return {
    current: { version, key: version === 'v1' ? V1_KEY : V2_KEY },
    ...(previous === undefined ? {} : { previous }),
  };
}

function createAdapter(database: FakeDrizzleDatabase, config = encryption()): ReturnType<typeof drizzleAdapter> {
  const options: DrizzleAdapterOptions = {
    db: database as unknown as DrizzleAdapterOptions['db'],
    dialect: 'postgres',
    encryption: config,
  };
  return drizzleAdapter(options);
}

function createSeedRow(overrides: Partial<FakeDrizzleRow> = {}): FakeDrizzleRow {
  return {
    id: 'key_1',
    user_id: 'user_1',
    provider: 'openai',
    label: 'default',
    key_hint: '1234',
    credentials_ciphertext: 'ciphertext',
    credentials_nonce: 'nonce',
    encryption_key_version: 'v1',
    created_at: '2026-07-17T00:00:00.000Z',
    updated_at: '2026-07-17T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-17T00:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('drizzleAdapter', () => {
  it('saves, gets, gets by id, and deletes credentials', async () => {
    const database = createFakeDrizzle();
    const adapter = createAdapter(database);

    const metadata = await adapter.save(saveInput);

    await expect(adapter.get(saveInput)).resolves.toEqual({ apiKey: API_KEY });
    await expect(adapter.getById({ userId: 'user_1', keyId: metadata.id })).resolves.toEqual({
      ...metadata,
      credentials: { apiKey: API_KEY },
    });
    await expect(adapter.get({ ...saveInput, provider: 'missing' })).resolves.toBeNull();
    await expect(adapter.getById({ userId: 'user_2', keyId: metadata.id })).resolves.toBeNull();

    await adapter.delete({ userId: 'user_1', keyId: metadata.id });
    await expect(adapter.get(saveInput)).resolves.toBeNull();
  });

  it('returns exactly metadata keys from save and list', async () => {
    const database = createFakeDrizzle();
    const adapter = createAdapter(database);
    const saved = await adapter.save(saveInput);
    const listed = await adapter.list({ userId: 'user_1' });

    expect(Object.keys(saved).sort()).toEqual([...keyMetadataKeys].sort());
    expect(Object.keys(listed[0] ?? {}).sort()).toEqual([...keyMetadataKeys].sort());
    expect(JSON.stringify({ saved, listed })).not.toContain(API_KEY);
    for (const metadata of [saved, ...(listed as KeyMetadata[])]) {
      expect(metadata).not.toHaveProperty('credentials_ciphertext');
      expect(metadata).not.toHaveProperty('credentials_nonce');
      expect(metadata).not.toHaveProperty('encryption_key_version');
      expect(metadata).not.toHaveProperty('credentials');
    }
  });

  it('stores ciphertext instead of plaintext credentials', async () => {
    const database = createFakeDrizzle();
    await createAdapter(database).save(saveInput);

    const row = database.rows[0];
    expect(row).toBeDefined();
    expect(row?.credentials_ciphertext).not.toContain(API_KEY);
    expect(Buffer.from(row?.credentials_ciphertext ?? '', 'base64url').toString('utf8')).not.toBe(API_KEY);
  });

  it('reads previous-key rows and writes new rows with the current key version', async () => {
    const database = createFakeDrizzle();
    const firstAdapter = createAdapter(database, encryption('v1'));
    await firstAdapter.save(saveInput);

    const rotatedAdapter = createAdapter(database, encryption('v2', [{ version: 'v1', key: V1_KEY }]));
    await expect(rotatedAdapter.get(saveInput)).resolves.toEqual({ apiKey: API_KEY });

    await rotatedAdapter.save({
      ...saveInput,
      label: 'secondary',
      credentials: { apiKey: 'sk-test-9999' },
      keyHint: '9999',
    });

    const row = database.rows.find((entry) => entry.label === 'secondary');
    expect(row?.encryption_key_version).toBe('v2');
    await expect(rotatedAdapter.get({ ...saveInput, label: 'secondary' })).resolves.toEqual({
      apiKey: 'sk-test-9999',
    });
  });

  it('rejects rows whose encryption key version is not configured', async () => {
    const database = createFakeDrizzle();
    const first = await createAdapter(database, encryption('v1')).save(saveInput);
    const row = database.rows.find((entry) => entry.id === first.id);
    const adapter = createAdapter(database, encryption('v2'));

    if (row === undefined) {
      throw new Error('Expected the saved row to exist');
    }

    const failure = await adapter.get(saveInput).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AiSdkByokAdapterError);
    expect((failure as Error).message).not.toContain(row.credentials_ciphertext);
    expect((failure as Error).message).not.toContain(row.credentials_nonce);
    expect((failure as Error).message).not.toContain(V1_KEY);

    const byIdFailure = await adapter
      .getById({ userId: 'user_1', keyId: first.id })
      .catch((error: unknown) => error);
    expect(byIdFailure).toBeInstanceOf(AiSdkByokAdapterError);
    expect((byIdFailure as Error).message).not.toContain(row.credentials_ciphertext);
    expect((byIdFailure as Error).message).not.toContain(row.credentials_nonce);
    expect((byIdFailure as Error).message).not.toContain(V1_KEY);
  });

  it('rejects duplicate and invalid encryption key versions during construction', () => {
    const database = createFakeDrizzle();

    expect(() => createAdapter(database, encryption('v1', [{ version: 'v1', key: V1_KEY }]))).toThrow(
      AiSdkByokValidationError,
    );
    expect(() =>
      createAdapter(database, {
        current: { version: '  ', key: V1_KEY },
      }),
    ).toThrow(AiSdkByokValidationError);
  });

  it('redacts database errors from every adapter operation', async () => {
    const fakeSecret = 'fake-db-secret-should-not-leak';
    const operations: Array<[string, (adapter: ReturnType<typeof drizzleAdapter>) => Promise<unknown>]> = [
      ['save', (adapter) => adapter.save(saveInput)],
      ['list', (adapter) => adapter.list({ userId: 'user_1' })],
      ['get', (adapter) => adapter.get(saveInput)],
      ['getById', (adapter) => adapter.getById({ userId: 'user_1', keyId: 'key_1' })],
      ['delete', (adapter) => adapter.delete({ userId: 'user_1', keyId: 'key_1' })],
    ];

    for (const [operation, run] of operations) {
      const database = createFakeDrizzle({ error: new Error(`${operation} failed with ${fakeSecret}`) });
      const failure = await run(createAdapter(database)).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(AiSdkByokAdapterError);
      expect((failure as Error).message).not.toContain(fakeSecret);
    }
  });

  it('orders list results by updatedAt descending and then createdAt descending', async () => {
    const database = createFakeDrizzle({
      rows: [
        createSeedRow({
          id: 'older-created',
          provider: 'older-created',
          created_at: '2026-07-17T00:00:00.000Z',
          updated_at: '2026-07-18T00:00:00.000Z',
        }),
        createSeedRow({
          id: 'newer-created',
          provider: 'newer-created',
          created_at: '2026-07-18T00:00:00.000Z',
          updated_at: '2026-07-18T00:00:00.000Z',
        }),
        createSeedRow({
          id: 'newer-updated',
          provider: 'newer-updated',
          created_at: '2026-07-17T00:00:00.000Z',
          updated_at: '2026-07-19T00:00:00.000Z',
        }),
        createSeedRow({ id: 'other-user', user_id: 'user_2', provider: 'other-user' }),
      ],
    });

    await expect(createAdapter(database).list({ userId: 'user_1' })).resolves.toMatchObject([
      { provider: 'newer-updated' },
      { provider: 'newer-created' },
      { provider: 'older-created' },
    ]);
  });

  it('preserves id and createdAt while upserting key material', async () => {
    const database = createFakeDrizzle();
    const adapter = createAdapter(database);
    const first = await adapter.save(saveInput);
    const firstRow = database.rows[0] === undefined ? undefined : { ...database.rows[0] };

    vi.setSystemTime(new Date('2026-07-18T00:00:00.000Z'));
    const second = await adapter.save({ ...saveInput, credentials: { apiKey: 'sk-test-9999' }, keyHint: '9999' });
    const secondRow = database.rows[0];

    expect(second.id).toBe(first.id);
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.updatedAt).toBe('2026-07-18T00:00:00.000Z');
    expect(second.keyHint).toBe('9999');
    expect(secondRow?.id).toBe(firstRow?.id);
    expect(secondRow?.created_at).toBe(firstRow?.created_at);
    expect(secondRow?.updated_at).toBe('2026-07-18T00:00:00.000Z');
    expect(secondRow?.key_hint).toBe('9999');
    expect(secondRow?.credentials_ciphertext).not.toBe(firstRow?.credentials_ciphertext);
    await expect(adapter.get(saveInput)).resolves.toEqual({ apiKey: 'sk-test-9999' });
  });

  it('rejects a missing or unsupported dialect', () => {
    const database = createFakeDrizzle();
    const options: DrizzleAdapterOptions = {
      db: database as unknown as DrizzleAdapterOptions['db'],
      dialect: 'postgres',
      encryption: encryption(),
    };

    expect(() => drizzleAdapter({ ...options, dialect: undefined as never })).toThrow(AiSdkByokValidationError);
    expect(() => drizzleAdapter({ ...options, dialect: 'sqlite' as never })).toThrow(AiSdkByokValidationError);
  });

  it('makes delete idempotent through the public manager', async () => {
    const database = createFakeDrizzle();
    const manager = createByokManager({ storage: createAdapter(database) });
    const metadata = await manager.keys.save({
      userId: 'user_1',
      provider: 'openai',
      credentials: { apiKey: API_KEY },
    });

    await manager.keys.delete({ userId: 'user_1', keyId: metadata.id });
    await manager.keys.delete({ userId: 'user_1', keyId: metadata.id });

    await expect(manager.keys.getById({ userId: 'user_1', keyId: metadata.id })).resolves.toBeNull();
  });
});
