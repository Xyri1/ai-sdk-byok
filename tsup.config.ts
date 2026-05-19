import { defineConfig } from 'tsup';

export default defineConfig({
  clean: true,
  dts: true,
  entry: {
    'core/index': 'packages/core/src/index.ts',
      'supabase/index': 'packages/supabase/src/index.ts',
    },
  external: ['ai-sdk-byok'],
  format: ['esm'],
  platform: 'neutral',
  sourcemap: true,
  splitting: false,
  target: 'es2022',
  treeshake: true,
});
