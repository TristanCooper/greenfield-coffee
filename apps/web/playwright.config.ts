// apps/web/playwright.config.ts
//
// Card 13 / Playwright E2E test config.
//
// WHAT THIS CONFIG DOES
//
//   1. Sets `baseURL` from `PLAYWRIGHT_BASE_URL` (default
//      `http://localhost:3000`).
//   2. Auto-starts `pnpm dev` via `webServer` if no server is
//      already running on the port. The `reuseExistingServer`
//      option lets a developer with `pnpm dev` already running
//      run the tests without port collisions.
//   3. Runs the `chromium` project only — the other browsers
//      (firefox, webkit) are out of scope for v1 (per the
//      card body).
//   4. Loads `global-setup.ts` (the auth + DB-reset script).
//
// REQUIRED ENV VARS
//
//   - NEXT_PUBLIC_SUPABASE_URL       (the project URL)
//   - NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
//   - SUPABASE_SERVICE_ROLE_KEY      (admin API: createUser,
//                                    generateLink)
//   - DATABASE_URL                   (test DB reset, assertions)
//
//   See apps/web/playwright/README.md for the full setup.
//
// FAILURE MODES
//
//   - Missing env vars → tests fail with a clear "Missing
//     env var" error in the global setup. The setup function
//     reads the env explicitly so the failure is loud.
//   - No dev server + auto-start fails → Playwright fails
//     after a 60s timeout. Check the dev server logs.
//   - Stale `.next` cache → the dev server throws ENOENT on
//     the first request. `rm -rf apps/web/.next` resolves it.

import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PLAYWRIGHT_PORT ?? 3000);
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  // The test files live in apps/web/playwright/ alongside
  // this config. The relative `testDir` keeps them scoped to
  // the web app; a future multi-app test setup moves the
  // config to the repo root.
  testDir: './playwright',

  // Reasonable defaults: 30s per test, fail on console
  // errors except the known noise (third-party assets etc.).
  // The `expect.toHaveTitle` and similar are 5s by default.
  timeout: 30_000,
  expect: { timeout: 5_000 },

  // Sequential by default. The receiving-green test mutates
  // the same DB rows the global setup just created; running
  // tests in parallel would race. Parallel is opt-in per-test
  // (use `test.describe.configure({ mode: 'parallel' })` in
  // a test that wants it).
  fullyParallel: false,
  workers: 1,

  // The dev server. Reuse if already running, otherwise
  // start `pnpm dev` from the apps/web dir (the cwd defaults
  // to the config file's directory).
  webServer: {
    command: 'pnpm dev',
    port: PORT,
    reuseExistingServer: true,
    timeout: 60_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },

  // Reporter. List on stdout for local runs, dot for CI.
  reporter: process.env.CI ? 'dot' : 'list',

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // The wizard uses a stepper that's keyboard-navigable
    // but click-driven is the common path. We don't force
    // either; tests use click via `getByRole`.
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  globalSetup: './playwright/global-setup.ts',
});
