import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 30000,
    hookTimeout: 120000,
    // One in-memory Mongo per test file (own DB → full isolation); run files
    // sequentially. beforeAll retries the mongod start to absorb rare churn.
    fileParallelism: false,
    // Absorb rare transient request failures under heavy sequential mongod
    // churn — a genuinely broken test still fails all attempts.
    retry: 2,
  },
});
