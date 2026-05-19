import { describe, expect, it, vi } from 'vitest';
import { AiSdkByokAdapterError } from 'ai-sdk-byok';
import { supabaseAdapter } from './adapter.js';

interface SupabaseErrorLike {
  message?: string;
}

interface QueryResponse {
  data: unknown;
  error: SupabaseErrorLike | null;
}

interface SupabaseClientLike {
  rpc(functionName: string, args: Record<string, unknown>): PromiseLike<QueryResponse>;
  from(table: string): {
    select(columns: string): ReturnType<typeof createQuery>;
  };
}

const metadataRow = {
  id: 'key_1',
  user_id: 'user_1',
  provider: 'openai',
  label: 'default',
  key_hint: '1234',
  created_at: '2026-05-19T00:00:00.000Z',
  updated_at: '2026-05-19T00:00:00.000Z',
};

function createRpc(data: unknown, error: { message?: string } | null = null): SupabaseClientLike['rpc'] {
  return vi.fn(async () => ({ data, error }));
}

function createQuery(listResponseOverride?: Partial<QueryResponse>, maybeSingleOverride?: Partial<QueryResponse>) {
  const listResponse: QueryResponse = {
    data: [metadataRow],
    error: null,
    ...listResponseOverride,
  };
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    order: vi.fn(() => query),
    then: vi.fn((resolve) => Promise.resolve(resolve(listResponse))),
    maybeSingle: vi.fn(async () => ({
      data: metadataRow,
      error: null,
      ...maybeSingleOverride,
    })),
  };

  return query;
}

function createClient(
  overrides: Partial<SupabaseClientLike> = {},
  listResponseOverride?: Partial<QueryResponse>,
  maybeSingleOverride?: Partial<QueryResponse>,
): SupabaseClientLike {
  const query = createQuery(listResponseOverride, maybeSingleOverride);

  return {
    rpc: createRpc(metadataRow),
    from: vi.fn(() => query) as SupabaseClientLike['from'],
    ...overrides,
  };
}

describe('supabaseAdapter', () => {
  it('saves JSON encoded credentials through RPC and returns metadata', async () => {
    const client = createClient();
    const adapter = supabaseAdapter({ client });

    const metadata = await adapter.save({
      userId: 'user_1',
      provider: 'openai',
      label: 'default',
      credentials: { apiKey: 'sk-test-1234' },
      keyHint: '1234',
    });

    expect(client.rpc).toHaveBeenCalledWith('ai_sdk_byok_save_credentials', {
      p_user_id: 'user_1',
      p_provider: 'openai',
      p_credentials: JSON.stringify({ apiKey: 'sk-test-1234' }),
      p_label: 'default',
      p_key_hint: '1234',
    });
    expect(client.from).not.toHaveBeenCalled();
    expect(metadata).toMatchObject({ id: 'key_1', keyHint: '1234' });
  });

  it('fetches saved metadata when the save RPC returns a legacy key id', async () => {
    const client = createClient({
      rpc: createRpc('key_1'),
    });
    const adapter = supabaseAdapter({ client });

    await expect(
      adapter.save({
        userId: 'user_1',
        provider: 'openai',
        label: 'default',
        credentials: { apiKey: 'sk-test-1234' },
        keyHint: '1234',
      }),
    ).resolves.toMatchObject({ id: 'key_1', keyHint: '1234' });

    expect(client.from).toHaveBeenCalledWith('ai_sdk_byok_keys');
  });

  it('wraps legacy save metadata fetch failures', async () => {
    const client = createClient(
      {
        rpc: createRpc('key_1'),
      },
      undefined,
      { data: null, error: { message: 'missing metadata' } },
    );
    const adapter = supabaseAdapter({ client });

    await expect(
      adapter.save({
        userId: 'user_1',
        provider: 'openai',
        label: 'default',
        credentials: { apiKey: 'sk-test-1234' },
        keyHint: '1234',
      }),
    ).rejects.toThrow(AiSdkByokAdapterError);
  });

  it('wraps invalid save metadata payloads', async () => {
    const client = createClient({
      rpc: createRpc(null),
    });
    const adapter = supabaseAdapter({ client });

    await expect(
      adapter.save({
        userId: 'user_1',
        provider: 'openai',
        label: 'default',
        credentials: { apiKey: 'sk-test-1234' },
        keyHint: '1234',
      }),
    ).rejects.toThrow(AiSdkByokAdapterError);
  });

  it('lists metadata without vault secret identifiers', async () => {
    const client = createClient();
    const adapter = supabaseAdapter({ client });

    await expect(adapter.list({ userId: 'user_1' })).resolves.toEqual([
      {
        id: 'key_1',
        userId: 'user_1',
        provider: 'openai',
        label: 'default',
        keyHint: '1234',
        createdAt: '2026-05-19T00:00:00.000Z',
        updatedAt: '2026-05-19T00:00:00.000Z',
      },
    ]);

    expect(client.from).toHaveBeenCalledWith('ai_sdk_byok_keys');
  });

  it('wraps list failures', async () => {
    const client = createClient({}, { data: null, error: { message: 'permission denied' } });
    const adapter = supabaseAdapter({ client });

    await expect(adapter.list({ userId: 'user_1' })).rejects.toThrow(AiSdkByokAdapterError);
  });

  it('parses credential JSON returned by get', async () => {
    const client = createClient({
      rpc: createRpc(JSON.stringify({ apiKey: 'sk-test-1234' })),
    });
    const adapter = supabaseAdapter({ client });

    await expect(adapter.get({ userId: 'user_1', provider: 'openai', label: 'default' })).resolves.toEqual({
      apiKey: 'sk-test-1234',
    });
  });

  it('returns null when get finds no credential', async () => {
    const client = createClient({
      rpc: createRpc(null),
    });
    const adapter = supabaseAdapter({ client });

    await expect(adapter.get({ userId: 'user_1', provider: 'openai', label: 'default' })).resolves.toBeNull();
  });

  it('wraps invalid credential JSON returned by get', async () => {
    const client = createClient({
      rpc: createRpc(JSON.stringify({ apiKey: 'sk-test-1234', extra: true })),
    });
    const adapter = supabaseAdapter({ client });

    await expect(adapter.get({ userId: 'user_1', provider: 'openai', label: 'default' })).rejects.toThrow(
      AiSdkByokAdapterError,
    );
  });

  it('deletes credentials through RPC', async () => {
    const client = createClient({
      rpc: createRpc(true),
    });
    const adapter = supabaseAdapter({ client });

    await expect(adapter.delete({ userId: 'user_1', keyId: 'key_1' })).resolves.toBeUndefined();

    expect(client.rpc).toHaveBeenCalledWith('ai_sdk_byok_delete_credentials', {
      p_user_id: 'user_1',
      p_key_id: 'key_1',
    });
  });

  it('wraps Supabase errors without credential values', async () => {
    const client = createClient({
      rpc: createRpc(null, { message: 'database unavailable' }),
    });
    const adapter = supabaseAdapter({ client });

    await expect(
      adapter.save({
        userId: 'user_1',
        provider: 'openai',
        label: 'default',
        credentials: { apiKey: 'sk-secret-value' },
        keyHint: 'alue',
      }),
    ).rejects.toThrow(AiSdkByokAdapterError);

    await expect(
      adapter.save({
        userId: 'user_1',
        provider: 'openai',
        label: 'default',
        credentials: { apiKey: 'sk-secret-value' },
        keyHint: 'alue',
      }),
    ).rejects.not.toThrow('sk-secret-value');
  });
});
