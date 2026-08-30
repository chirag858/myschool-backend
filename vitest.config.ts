import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    // Keep the suite hermetic: never let a local `.env` point tests at real
    // external services (R2 bucket writes, live SMTP sends). Blank them here.
    env: {
      R2_ACCOUNT_ID: '',
      R2_ACCESS_KEY_ID: '',
      R2_SECRET_ACCESS_KEY: '',
      R2_BUCKET: '',
      R2_PUBLIC_URL: '',
      SMTP_HOST: '',
      SMTP_USER: '',
      SMTP_PASS: '',
      SMTP_FROM: '',
    },
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
