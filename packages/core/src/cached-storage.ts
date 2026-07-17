import { AiSdkByokValidationError } from './errors.js';
import type {
  ByokStorageAdapter,
  GetStorageByIdInput,
  StoredKeyCredentialRecord,
} from './types.js';

export interface CredentialRecordCacheSetOptions {
  ttlMs: number;
}

export interface CredentialRecordCache {
  get(input: GetStorageByIdInput): Promise<StoredKeyCredentialRecord | null>;
  set(
    input: GetStorageByIdInput,
    record: StoredKeyCredentialRecord,
    options: CredentialRecordCacheSetOptions,
  ): Promise<void>;
  delete(input: GetStorageByIdInput): Promise<void>;
}

export interface CachedStorageOptions {
  storage: ByokStorageAdapter;
  cache: CredentialRecordCache;
  ttlMs: number;
}

function assertExplicitTtl(ttlMs: number): void {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new AiSdkByokValidationError('ttlMs must be a positive finite number');
  }
}

export function cachedStorage(options: CachedStorageOptions): ByokStorageAdapter {
  assertExplicitTtl(options.ttlMs);

  const invalidate = async (input: GetStorageByIdInput): Promise<void> => {
    try {
      await options.cache.delete(input);
    } catch {
      // Invalidation is best-effort; the entry's TTL bounds how long a stale credential survives.
    }
  };

  return {
    save: async (input) => {
      const metadata = await options.storage.save(input);
      await invalidate({ userId: metadata.userId, keyId: metadata.id });
      return metadata;
    },

    list: (input) => options.storage.list(input),

    get: (input) => options.storage.get(input),

    getById: async (input) => {
      try {
        const cachedRecord = await options.cache.get(input);

        if (cachedRecord !== null) {
          return cachedRecord;
        }
      } catch {
        return options.storage.getById(input);
      }

      const storedRecord = await options.storage.getById(input);

      if (storedRecord !== null) {
        try {
          await options.cache.set(input, storedRecord, { ttlMs: options.ttlMs });
        } catch {
          // Cache population is a read-path optimization; storage remains the source of truth.
        }
      }

      return storedRecord;
    },

    delete: async (input) => {
      await invalidate(input);
      await options.storage.delete(input);
      await invalidate(input);
    },
  };
}
