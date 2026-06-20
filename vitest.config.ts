import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Root Vitest config: workspace-wide unit test runner.
//
// Each project gets its own Vitest environment — the web project's Route
// Handler tests rely on NextResponse / next/server semantics and need
// node-friendly module resolution, but DON'T need jsdom (no DOM assertions
// here yet — pure handler logic). Add `environment: 'jsdom'` later when
// Client Component tests land.
//
// `.worktrees/` excluded — those are leftover git worktrees from prior
// kanban worker attempts. Their test files (which sometimes compile
// against older source snapshots) leak into vitest's discovery because
// the include globs are relative to CWD.

// The `projects` field is a vitest multi-project setup; it's
// supported at runtime but not in the public type. The cast
// below silences the type error; the runtime behaviour is
// unchanged.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./apps/web/src', import.meta.url)),
    },
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  test: {
    // Global excludes — apply across all projects. Playwright
    // E2E specs (`apps/web/playwright/`) are run by the
    // @playwright/test runner (`pnpm test:e2e`), not vitest.
    // Without this exclude, vitest tries to load the Playwright
    // spec files and fails on `test.describe` (the Playwright
    // function, not vitest's). Other test files that pick up
    // `*.spec.ts` would hit the same trap.
    exclude: [
      '**/node_modules/**',
      '**/.worktrees/**',
      '**/.next/**',
      '**/playwright/**',
      '**/dist/**',
      '**/.git/**',
    ],
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
} as unknown as Parameters<typeof defineConfig>[0]);
