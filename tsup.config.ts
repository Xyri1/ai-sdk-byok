import { defineConfig, type Options } from 'tsup';

const shared: Options = {
  clean: true,
  dts: true,
  format: ['esm'],
  platform: 'neutral' as const,
  sourcemap: true,
  splitting: false,
  target: 'es2022',
  treeshake: true,
};

export default defineConfig([
  {
    ...shared,
    entry: ['packages/core/src/index.ts'],
    outDir: 'packages/core/dist',
  },
  {
    ...shared,
    entry: ['packages/supabase/src/index.ts'],
    external: ['ai-sdk-byok', '@supabase/supabase-js'],
    outDir: 'packages/supabase/dist',
  },
  {
    ...shared,
    entry: ['packages/cloudflare/src/index.ts'],
    external: ['ai-sdk-byok'],
    outDir: 'packages/cloudflare/dist',
  },
]);
