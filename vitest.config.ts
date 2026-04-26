import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: [],
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 10_000,
  },
});
