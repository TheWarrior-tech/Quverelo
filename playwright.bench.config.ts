import { defineConfig } from '@playwright/test';

/** npm run bench: large-file timings (tests/bench), kept out of the normal e2e run. */
export default defineConfig({
  testDir: 'tests/bench',
  timeout: 600_000,
  expect: { timeout: 120_000 },
  workers: 1,
  reporter: 'list',
});
