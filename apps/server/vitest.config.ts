import { defineConfig } from 'vitest/config';

// Each parallel worker/agent can isolate its DB with TEST_DB=<name>.
const base = process.env.TEST_DATABASE_BASE ?? 'postgres://postgres:ielts@localhost:5433';
const dbName = `ielts_test_${(process.env.TEST_DB ?? 'main').replace(/\W/g, '_')}`;

export default defineConfig({
  test: {
    env: { NODE_ENV: 'test', DATABASE_URL: `${base}/${dbName}`, TEST_DB_NAME: dbName, TEST_DATABASE_BASE: base },
    globalSetup: ['./src/test/global-setup.ts'],
    setupFiles: ['./src/test/setup.ts'],
    fileParallelism: false,
    testTimeout: 20000,
  },
});
