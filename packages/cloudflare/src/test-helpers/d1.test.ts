import { afterEach, describe, expect, it } from 'vitest';
import { createFakeD1, type FakeD1Database } from './d1.js';

const INSERT_SQL = `
INSERT INTO ai_sdk_byok_keys (id, user_id, provider, label, key_hint, credentials_ciphertext, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (user_id, provider, label) DO UPDATE SET
  key_hint = excluded.key_hint,
  credentials_ciphertext = excluded.credentials_ciphertext,
  updated_at = excluded.updated_at
RETURNING id, user_id, provider, label, key_hint, created_at, updated_at;
`;

interface MetadataRow {
  id: string;
  created_at: string;
  updated_at: string;
  key_hint: string;
}

let db: (FakeD1Database & { close(): void }) | null = null;

afterEach(() => {
  db?.close();
  db = null;
});

describe('createFakeD1', () => {
  it('applies the migration and supports upsert with RETURNING', async () => {
    db = createFakeD1();

    const inserted = await db
      .prepare(INSERT_SQL)
      .bind('id-1', 'user_1', 'openai', 'default', '1234', 'v1.sealed', '2026-07-17T00:00:00.000Z', '2026-07-17T00:00:00.000Z')
      .first<MetadataRow>();

    expect(inserted?.id).toBe('id-1');

    const rotated = await db
      .prepare(INSERT_SQL)
      .bind('id-2', 'user_1', 'openai', 'default', '5678', 'v1.sealed2', '2026-07-18T00:00:00.000Z', '2026-07-18T00:00:00.000Z')
      .first<MetadataRow>();

    expect(rotated?.id).toBe('id-1');
    expect(rotated?.created_at).toBe('2026-07-17T00:00:00.000Z');
    expect(rotated?.updated_at).toBe('2026-07-18T00:00:00.000Z');
    expect(rotated?.key_hint).toBe('5678');
  });

  it('supports all() and idempotent run()', async () => {
    db = createFakeD1();

    const empty = await db.prepare('SELECT * FROM ai_sdk_byok_keys;').all();
    expect(empty.results).toEqual([]);

    await db.prepare('DELETE FROM ai_sdk_byok_keys WHERE id = ?;').bind('missing').run();
  });
});
