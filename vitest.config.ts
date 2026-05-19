import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      'ai-sdk-byok': new URL('./packages/core/src/index.ts', import.meta.url).pathname,
      'ai-sdk-byok/supabase': new URL('./packages/supabase/src/index.ts', import.meta.url).pathname,
    },
  },
  test: {
    coverage: {
      reporter: ['text', 'lcov'],
    },
    environment: 'node',
    include: ['packages/**/*.test.ts'],
  },
});
