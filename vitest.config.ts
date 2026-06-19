import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Root Vitest config: workspace-wide unit test runner.
//
// Each project gets its own Vitest environment — the web project's Route
// Handler tests rely on NextResponse / next/server semantics and need
// node-friendly module resolution, but DON'T need jsdom (no DOM assertions
// here yet — pure handler logic). Add `environment: 'jsdom'` later when
// Client Component tests land.

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./apps/web/src', import.meta.url)),
    },
  },
  test: {
    projects: [
      {
        test: {
          name: 'db',
          include: ['packages/db/src/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'money',
          include: ['packages/money/src/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'web',
          include: ['apps/web/src/**/*.test.ts'],
        },
      },
    ],
  },
});
