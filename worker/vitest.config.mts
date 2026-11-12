import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-plugin';

export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: './worker/wrangler.test.toml' } })],
  test: {
    include: ['worker/src/**/*.test.ts'],
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
