import type { DrizzleAdapterOptions } from '@ai-sdk-byok/drizzle';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

export type Sql = ReturnType<typeof postgres>;

export interface Database {
  sql: Sql;
  db: DrizzleAdapterOptions['db'];
}

export function createDatabase(databaseUrl: string): Database {
  const sql = postgres(databaseUrl, { onnotice: () => {} });
  // PostgresJsDatabase pins the schema generic to Record<string, never>; the
  // adapter accepts any Postgres Drizzle database, so widen it once here.
  const db = drizzle(sql) as unknown as DrizzleAdapterOptions['db'];
  return { sql, db };
}
