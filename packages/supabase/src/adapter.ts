import {
  AiSdkByokAdapterError,
  type ApiKeyCredentials,
  type ByokManagerOptions,
  type KeyMetadata,
} from 'ai-sdk-byok';

interface SupabaseResponse<T> {
  data: T | null;
  error: { message?: string } | null;
}

interface SupabaseQueryBuilder extends PromiseLike<SupabaseResponse<unknown>> {
  eq(column: string, value: string): SupabaseQueryBuilder;
  order(column: string, options: { ascending: boolean }): SupabaseQueryBuilder;
  maybeSingle(): PromiseLike<SupabaseResponse<unknown>>;
}

interface SupabaseFromBuilder {
  select(columns: string): SupabaseQueryBuilder;
}

interface SupabaseClientLike {
  rpc(functionName: string, args: Record<string, unknown>): PromiseLike<SupabaseResponse<unknown>>;
  from(table: string): SupabaseFromBuilder;
}

interface SupabaseAdapterOptions {
  client: unknown;
}

interface KeyMetadataRow {
  id: string;
  user_id: string;
  provider: string;
  label: string;
  key_hint: string;
  created_at: string;
  updated_at: string;
}

function adapterError(operation: string, cause: unknown): AiSdkByokAdapterError {
  return new AiSdkByokAdapterError(`Supabase BYOK adapter failed during ${operation}`, { cause });
}

function toMetadata(row: KeyMetadataRow): KeyMetadata {
  return {
    id: row.id,
    userId: row.user_id,
    provider: row.provider,
    label: row.label,
    keyHint: row.key_hint,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function fetchMetadataById(client: SupabaseClientLike, keyId: string): Promise<KeyMetadata> {
  const metadataResult = await client
    .from('ai_sdk_byok_keys')
    .select('id,user_id,provider,label,key_hint,created_at,updated_at')
    .eq('id', keyId)
    .maybeSingle();

  if (metadataResult.error || metadataResult.data === null) {
    throw adapterError('save metadata fetch', metadataResult.error ?? new Error('Missing saved metadata row'));
  }

  return toMetadata(metadataResult.data as KeyMetadataRow);
}

function parseMetadata(value: unknown): KeyMetadata {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Save RPC returned an invalid metadata payload');
  }

  return toMetadata(value as KeyMetadataRow);
}

function parseCredentials(value: unknown): ApiKeyCredentials {
  if (typeof value !== 'string') {
    throw new Error('Credential RPC returned a non-string payload');
  }

  const parsed: unknown = JSON.parse(value);

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed) ||
    Object.keys(parsed).length !== 1 ||
    typeof (parsed as { apiKey?: unknown }).apiKey !== 'string'
  ) {
    throw new Error('Credential RPC returned an invalid payload shape');
  }

  return { apiKey: (parsed as { apiKey: string }).apiKey };
}

export function supabaseAdapter(options: SupabaseAdapterOptions): ByokManagerOptions['storage'] {
  const client = options.client as SupabaseClientLike;

  return {
    async save(input) {
      const credentials = JSON.stringify(input.credentials);
      const rpcResult = await client.rpc('ai_sdk_byok_save_credentials', {
        p_user_id: input.userId,
        p_provider: input.provider,
        p_credentials: credentials,
        p_label: input.label,
        p_key_hint: input.keyHint,
      });

      if (rpcResult.error) {
        throw adapterError('save', rpcResult.error);
      }

      if (typeof rpcResult.data === 'string') {
        return fetchMetadataById(client, rpcResult.data);
      }

      try {
        return parseMetadata(rpcResult.data);
      } catch (error) {
        throw adapterError('save parse', error);
      }
    },

    async list(input) {
      const result = await client
        .from('ai_sdk_byok_keys')
        .select('id,user_id,provider,label,key_hint,created_at,updated_at')
        .eq('user_id', input.userId)
        .order('updated_at', { ascending: false })
        .order('created_at', { ascending: false });

      if (result.error) {
        throw adapterError('list', result.error);
      }

      return ((result.data as KeyMetadataRow[] | null) ?? []).map(toMetadata);
    },

    async get(input) {
      const result = await client.rpc('ai_sdk_byok_get_credentials', {
        p_user_id: input.userId,
        p_provider: input.provider,
        p_label: input.label,
      });

      if (result.error) {
        throw adapterError('get', result.error);
      }

      if (result.data === null) {
        return null;
      }

      try {
        return parseCredentials(result.data);
      } catch (error) {
        throw adapterError('get parse', error);
      }
    },

    async delete(input) {
      const result = await client.rpc('ai_sdk_byok_delete_credentials', {
        p_user_id: input.userId,
        p_key_id: input.keyId,
      });

      if (result.error) {
        throw adapterError('delete', result.error);
      }
    },
  };
}
