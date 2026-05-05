import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // globalSetup boots embedded-postgres once for the run; setupFiles
    // populates env defaults inside each worker. Order: globalSetup →
    // worker spawn (inherits env) → setupFiles → test files.
    globalSetup: ['src/test-globalSetup.ts'],
    setupFiles: ['src/test-setup.ts'],
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    // First run initialises Postgres (~20s on cold cache); reuse after.
    // Bump the global timeout to absorb the cold-start without flakes.
    testTimeout: 15_000,
    hookTimeout: 60_000,
  },
});
