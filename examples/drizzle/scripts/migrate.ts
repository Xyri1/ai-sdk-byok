import { existsSync } from 'node:fs';
import postgres from 'postgres';
import { runMigrations } from '../src/migrate';

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required. Copy .env.example to .env and set it.');
  process.exit(1);
}

const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });

try {
  for (const result of await runMigrations(sql)) {
    console.log(`${result.table}: ${result.status}`);
  }
} catch (error) {
  console.error('Migration failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

await sql.end();
