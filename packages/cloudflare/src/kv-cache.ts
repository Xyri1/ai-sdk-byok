import {
  AiSdkByokAdapterError,
  type CredentialRecordCache,
  type GetStorageByIdInput,
  type StoredKeyCredentialRecord,
} from 'ai-sdk-byok';
import { createSealer, credentialAad, type EncryptionKeyInput } from './crypto.js';

interface KvNamespaceLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface KvCredentialCacheOptions {
  namespace: unknown;
  encryptionKey: EncryptionKeyInput;
  keyPrefix?: string;
}

interface CachePayload {
  record: StoredKeyCredentialRecord;
  expiresAt: number;
}

const DEFAULT_KEY_PREFIX = 'ai-sdk-byok:';
const MIN_KV_EXPIRATION_SECONDS = 60;

const encoder = new TextEncoder();

function cacheError(operation: string, cause: unknown): AiSdkByokAdapterError {
  return new AiSdkByokAdapterError(`Cloudflare KV BYOK credential cache failed during ${operation}`, { cause });
}

async function cacheKey(prefix: string, input: GetStorageByIdInput): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(credentialAad(input.userId, input.keyId)));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${prefix}${hex}`;
}

function parsePayload(plaintext: string): CachePayload {
  const parsed: unknown = JSON.parse(plaintext);

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as { expiresAt?: unknown }).expiresAt !== 'number' ||
    typeof (parsed as { record?: unknown }).record !== 'object' ||
    (parsed as { record: unknown }).record === null ||
    typeof ((parsed as { record: { credentials?: { apiKey?: unknown } } }).record.credentials?.apiKey) !== 'string'
  ) {
    throw new Error('Cache payload has an invalid shape');
  }

  return parsed as CachePayload;
}

export function kvCredentialCache(options: KvCredentialCacheOptions): CredentialRecordCache {
  const namespace = options.namespace as KvNamespaceLike;
  const sealer = createSealer(options.encryptionKey);
  const prefix = options.keyPrefix ?? DEFAULT_KEY_PREFIX;

  async function bestEffortDelete(key: string): Promise<void> {
    try {
      await namespace.delete(key);
    } catch {
      // Physical expirationTtl remains as the cleanup backstop.
    }
  }

  return {
    async get(input) {
      const key = await cacheKey(prefix, input);

      let raw: string | null;
      try {
        raw = await namespace.get(key);
      } catch (error) {
        throw cacheError('get', error);
      }

      if (raw === null) {
        return null;
      }

      let payload: CachePayload;
      try {
        payload = parsePayload(await sealer.unseal(raw, credentialAad(input.userId, input.keyId)));
      } catch {
        await bestEffortDelete(key);
        return null;
      }

      if (payload.expiresAt <= Date.now()) {
        await bestEffortDelete(key);
        return null;
      }

      return payload.record;
    },

    async set(input, record, setOptions) {
      const key = await cacheKey(prefix, input);

      try {
        const payload: CachePayload = { record, expiresAt: Date.now() + setOptions.ttlMs };
        const sealed = await sealer.seal(JSON.stringify(payload), credentialAad(input.userId, input.keyId));
        await namespace.put(key, sealed, {
          expirationTtl: Math.max(MIN_KV_EXPIRATION_SECONDS, Math.ceil(setOptions.ttlMs / 1000)),
        });
      } catch (error) {
        throw cacheError('set', error);
      }
    },

    async delete(input) {
      const key = await cacheKey(prefix, input);

      try {
        await namespace.delete(key);
      } catch (error) {
        throw cacheError('delete', error);
      }
    },
  };
}
