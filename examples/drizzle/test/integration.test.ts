import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import type { DrizzleAdapterOptions } from '@ai-sdk-byok/drizzle';
import { drizzle } from 'drizzle-orm/postgres-js';
import { createManager } from '../src/byok';
import { postgresEndpointStore } from '../src/endpoints';
import { runMigrations } from '../src/migrate';

const databaseUrl = process.env.DATABASE_URL;
const describeIntegration = databaseUrl ? describe : describe.skip;
const MASTER_KEY = Buffer.from(new Uint8Array(32).fill(9)).toString('base64');
const SCHEMA = 'byok_example_test';

describeIntegration('integration (real Postgres)', () => {
  let sql: ReturnType<typeof postgres>;

  beforeAll(async () => {
    delete process.env.BYOK_REDIS_REST_URL;
    delete process.env.BYOK_REDIS_REST_TOKEN;

    const bootstrap = postgres(databaseUrl!, { max: 1, onnotice: () => {} });
    await bootstrap.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await bootstrap.unsafe(`CREATE SCHEMA ${SCHEMA}`);
    await bootstrap.end();

    sql = postgres(databaseUrl!, {
      max: 1,
      onnotice: () => {},
      connection: { search_path: SCHEMA },
    });
  });

  afterAll(async () => {
    await sql.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await sql.end();
  });

  it('applies migrations and reports already applied on re-run', async () => {
    const first = await runMigrations(sql);
    expect(first).toEqual([
      { table: 'ai_sdk_byok_keys', status: 'applied' },
      { table: 'custom_provider_endpoint', status: 'applied' },
    ]);

    const second = await runMigrations(sql);
    expect(second).toEqual([
      { table: 'ai_sdk_byok_keys', status: 'already applied' },
      { table: 'custom_provider_endpoint', status: 'already applied' },
    ]);
  });

  it('round-trips key CRUD and the endpoint row against real Postgres', async () => {
    const db = drizzle(sql) as unknown as DrizzleAdapterOptions['db'];
    const manager = createManager({ db, masterKey: MASTER_KEY });
    const endpoints = postgresEndpointStore(sql);

    const metadata = await manager.keys.save({
      userId: 'demo-user',
      provider: 'openai-compatible',
      credentials: { apiKey: 'sk-integration-1234' },
    });

    await endpoints.upsert(metadata.id, 'https://llm.internal/v1');
    expect(await endpoints.get(metadata.id)).toBe('https://llm.internal/v1');

    await endpoints.upsert(metadata.id, 'https://llm.internal/v2');
    expect(await endpoints.get(metadata.id)).toBe('https://llm.internal/v2');

    const listed = await manager.keys.list({ userId: 'demo-user' });
    expect(listed).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain('sk-integration-1234');

    const record = await manager.keys.getById({ userId: 'demo-user', keyId: metadata.id });
    expect(record?.credentials.apiKey).toBe('sk-integration-1234');

    await endpoints.delete(metadata.id);
    await manager.keys.delete({ userId: 'demo-user', keyId: metadata.id });
    expect(await endpoints.get(metadata.id)).toBeNull();
    expect(await manager.keys.list({ userId: 'demo-user' })).toEqual([]);
  });
});
