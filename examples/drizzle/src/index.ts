import { existsSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createApp } from './app';
import { createManager } from './byok';
import { createDatabase } from './db';
import { postgresEndpointStore } from './endpoints';
import { logger } from './logger';

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

const databaseUrl = process.env.DATABASE_URL;
const masterKey = process.env.AI_SDK_BYOK_MASTER_KEY;

if (!databaseUrl || !masterKey) {
  console.error('DATABASE_URL and AI_SDK_BYOK_MASTER_KEY are required. Copy .env.example to .env and fill them in.');
  process.exit(1);
}

const { sql, db } = createDatabase(databaseUrl);

let app: ReturnType<typeof createApp>;
try {
  app = createApp({
    manager: createManager({ db, masterKey }),
    endpoints: postgresEndpointStore(sql),
  });
} catch (error) {
  console.error(
    error instanceof Error
      ? error.message
      : 'The BYOK manager could not be created. Check AI_SDK_BYOK_MASTER_KEY (openssl rand -base64 32).',
  );
  process.exit(1);
}

app.use('*', serveStatic({ root: './public' }));

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port }, () => {
  logger.info('server.started', { port, url: `http://localhost:${port}` });
});
