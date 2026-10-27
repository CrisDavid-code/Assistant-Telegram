import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@lifeos/contracts': new URL('./packages/contracts/src/index.ts', import.meta.url).pathname } },
  test: { testTimeout: 20000, hookTimeout: 30000 },
});
