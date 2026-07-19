import { cachedStorage, createByokManager } from 'ai-sdk-byok';
import { drizzleAdapter, type DrizzleAdapterOptions } from '@ai-sdk-byok/drizzle';
import { logger } from './logger';
import { createRedisRestCredentialCache } from './redis-rest-cache';

export type ByokManager = ReturnType<typeof createByokManager>;

export interface CreateManagerOptions {
  db: DrizzleAdapterOptions['db'];
  masterKey: string;
}

export function createManager(options: CreateManagerOptions): ByokManager {
  const storage = drizzleAdapter({
    db: options.db,
    dialect: 'postgres',
    encryption: {
      current: { version: 'v1', key: options.masterKey },
    },
  });

  const credentialCache = createRedisRestCredentialCache();

  logger.info('storage.configured', {
    adapter: 'drizzle-postgres',
    cache: credentialCache ? 'redis-rest' : 'disabled',
    cacheTtlMs: credentialCache?.ttlMs,
  });

  return createByokManager({
    storage: credentialCache
      ? cachedStorage({ storage, cache: credentialCache.cache, ttlMs: credentialCache.ttlMs })
      : storage,
  });
}
