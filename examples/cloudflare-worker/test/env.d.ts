// `cloudflare:test`'s `env` export is typed as `Cloudflare.Env`, an empty
// interface meant to be extended by declaration merging (normally via
// generated `wrangler types` output). This example has no build step that
// runs `wrangler types`, so we merge our own worker `Env` plus the
// test-only `TEST_MIGRATIONS` binding used by `test/apply-migrations.ts`.
import type { D1Migration } from 'cloudflare:test';
import type { Env as WorkerEnv } from '../src/index';

declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

export {};
