import 'server-only';

import { logger } from './logger';

interface RedisRestResponse {
  result?: unknown;
}

interface CacheKeyInput {
  userId: string;
  keyId: string;
}

interface StoredKeyCredentialRecord {
  id: string;
  userId: string;
  provider: string;
  label: string;
  keyHint: string;
  createdAt: string;
  updatedAt: string;
  credentials: { apiKey: string };
}

interface CredentialRecordCacheSetOptions {
  ttlMs: number;
}

interface CredentialRecordCache {
  get(input: CacheKeyInput): Promise<StoredKeyCredentialRecord | null>;
  set(
    input: CacheKeyInput,
    record: StoredKeyCredentialRecord,
    options: CredentialRecordCacheSetOptions,
  ): Promise<void>;
  delete(input: CacheKeyInput): Promise<void>;
}

const DEFAULT_TTL_SECONDS = 60;

export function createRedisRestCredentialCache(): {
  cache: CredentialRecordCache;
  ttlMs: number;
} | null {
  const url = process.env.BYOK_REDIS_REST_URL;
  const token = process.env.BYOK_REDIS_REST_TOKEN;

  if (!url || !token) {
    logger.debug('credential-cache.disabled', {
      hasUrl: Boolean(url),
      hasToken: Boolean(token),
    });
    return null;
  }

  const ttlSeconds = Number(process.env.BYOK_CREDENTIAL_CACHE_TTL_SECONDS ?? DEFAULT_TTL_SECONDS);

  if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
    throw new Error('BYOK_CREDENTIAL_CACHE_TTL_SECONDS must be a positive integer when credential caching is enabled');
  }

  return {
    ttlMs: ttlSeconds * 1000,
    cache: {
      async get({ userId, keyId }) {
        const result = await redisCommand(url, token, ['GET', await cacheKey(userId, keyId)]);

        if (typeof result !== 'string') {
          logger.debug('credential-cache.read', { keyId, hit: false });
          return null;
        }

        const record = JSON.parse(result) as StoredKeyCredentialRecord;
        logger.info('key.served', {
          source: 'redis-rest-cache',
          userId: record.userId,
          keyId: record.id,
          provider: record.provider,
          label: record.label,
          keyHint: record.keyHint,
        });
        return record;
      },
      async set({ userId, keyId }, record, options) {
        await redisCommand(url, token, [
          'SET',
          await cacheKey(userId, keyId),
          JSON.stringify(record),
          'EX',
          String(ttlSecondsFromOptions(options)),
        ]);
        logger.debug('credential-cache.write', { keyId, ttlMs: options.ttlMs });
      },
      async delete({ userId, keyId }) {
        await redisCommand(url, token, ['DEL', await cacheKey(userId, keyId)]);
        logger.debug('credential-cache.delete', { keyId });
      },
    },
  };
}

function ttlSecondsFromOptions(options: CredentialRecordCacheSetOptions): string {
  return Math.max(1, Math.ceil(options.ttlMs / 1000)).toString();
}

async function redisCommand(url: string, token: string, command: string[]): Promise<unknown> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
    cache: 'no-store',
  });

  if (!response.ok) {
    logger.warn('credential-cache.request.failed', { status: response.status });
    throw new Error('Credential cache request failed');
  }

  const payload = (await response.json()) as RedisRestResponse;
  return payload.result;
}

async function cacheKey(userId: string, keyId: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${userId}:${keyId}`));
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

  return `ai-sdk-byok:credentials:v1:${hex}`;
}
