import type { Sql } from './db';

// App-owned lookaside table for openai-compatible base URLs. BYOK credentials
// stay { apiKey } only; there is no database foreign key — the app keeps rows
// in sync on save/delete.
export interface EndpointStore {
  get(keyId: string): Promise<string | null>;
  upsert(keyId: string, baseUrl: string): Promise<void>;
  delete(keyId: string): Promise<void>;
}

export function postgresEndpointStore(sql: Sql): EndpointStore {
  return {
    async get(keyId) {
      const rows = await sql`SELECT base_url FROM custom_provider_endpoint WHERE key_id = ${keyId}`;
      return rows.length > 0 ? (rows[0].base_url as string) : null;
    },
    async upsert(keyId, baseUrl) {
      await sql`
        INSERT INTO custom_provider_endpoint (key_id, base_url)
        VALUES (${keyId}, ${baseUrl})
        ON CONFLICT (key_id) DO UPDATE SET base_url = EXCLUDED.base_url
      `;
    },
    async delete(keyId) {
      await sql`DELETE FROM custom_provider_endpoint WHERE key_id = ${keyId}`;
    },
  };
}
