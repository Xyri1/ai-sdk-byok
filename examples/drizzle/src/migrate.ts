import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { Sql } from './db';

const require = createRequire(import.meta.url);

const CREATE_ENDPOINT_TABLE = `CREATE TABLE custom_provider_endpoint (
  key_id TEXT PRIMARY KEY,
  base_url TEXT NOT NULL
);`;

export interface MigrationStepResult {
  table: string;
  status: 'applied' | 'already applied';
}

export async function runMigrations(sql: Sql): Promise<MigrationStepResult[]> {
  // Resolved through the package exports map so the same script works for the
  // workspace link today and a registry install later.
  const byokSql = readFileSync(
    require.resolve('@ai-sdk-byok/drizzle/migrations/0001_ai_sdk_byok_init.sql'),
    'utf8',
  );

  const steps = [
    { table: 'ai_sdk_byok_keys', statement: byokSql },
    { table: 'custom_provider_endpoint', statement: CREATE_ENDPOINT_TABLE },
  ];

  const results: MigrationStepResult[] = [];
  for (const step of steps) {
    const [row] = await sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = current_schema() AND table_name = ${step.table}
      ) AS "exists"
    `;

    if (row.exists === true) {
      results.push({ table: step.table, status: 'already applied' });
      continue;
    }

    await sql.unsafe(step.statement);
    results.push({ table: step.table, status: 'applied' });
  }

  return results;
}
