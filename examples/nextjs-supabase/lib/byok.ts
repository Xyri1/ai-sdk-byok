import 'server-only';

import { cachedStorage, createByokManager } from 'ai-sdk-byok';
import { supabaseAdapter } from '@ai-sdk-byok/supabase';
import { createClient } from '@supabase/supabase-js';
import { logger } from './logger';
import { createRedisRestCredentialCache } from './redis-rest-cache';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
);

const storage = withCredentialSourceLogging(supabaseAdapter({ client: supabaseAdmin }));
const credentialCache = createRedisRestCredentialCache();

logger.info('storage.configured', {
  adapter: 'supabase-vault',
  cache: credentialCache ? 'redis-rest' : 'disabled',
  cacheTtlMs: credentialCache?.ttlMs,
});

export const byok = createByokManager({
  storage: credentialCache
    ? cachedStorage({
        storage,
        cache: credentialCache.cache,
        ttlMs: credentialCache.ttlMs,
      })
    : storage,
});

function withCredentialSourceLogging(
  storageAdapter: ReturnType<typeof supabaseAdapter>,
): ReturnType<typeof supabaseAdapter> {
  return {
    ...storageAdapter,
    async get(input) {
      const credentials = await storageAdapter.get(input);

      if (credentials !== null) {
        logger.info('key.served', {
          source: 'supabase-vault',
          userId: input.userId,
          provider: input.provider,
          label: input.label,
        });
      }

      return credentials;
    },
    async getById(input) {
      const record = await storageAdapter.getById(input);

      if (record !== null) {
        logger.info('key.served', {
          source: 'supabase-vault',
          userId: record.userId,
          keyId: record.id,
          provider: record.provider,
          label: record.label,
          keyHint: record.keyHint,
        });
      }

      return record;
    },
  };
}
