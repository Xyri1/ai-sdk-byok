import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';

const MIGRATION_URL = new URL('../../migrations/0001_ai_sdk_byok_init.sql', import.meta.url);

interface FakeD1PreparedStatement {
  bind(...values: unknown[]): FakeD1PreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[] }>;
  run(): Promise<void>;
}

export interface FakeD1Database {
  prepare(sql: string): FakeD1PreparedStatement;
}

export function createFakeD1(): FakeD1Database & { close(): void } {
  const db = new Database(':memory:');
  db.exec(readFileSync(MIGRATION_URL, 'utf8'));

  function createStatement(sql: string, values: unknown[]): FakeD1PreparedStatement {
    return {
      bind(...next: unknown[]) {
        return createStatement(sql, next);
      },
      async first<T>() {
        return ((db.prepare(sql).get(...values) as T | undefined) ?? null);
      },
      async all<T>() {
        return { results: db.prepare(sql).all(...values) as T[] };
      },
      async run() {
        db.prepare(sql).run(...values);
      },
    };
  }

  return {
    prepare(sql: string) {
      return createStatement(sql, []);
    },
    close() {
      db.close();
    },
  };
}
