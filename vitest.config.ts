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
          exclude: ['.worktrees/**', 'node_modules/**'],
        },
      },
      {
        test: {
          name: 'money',
          include: ['packages/money/src/**/*.test.ts'],
          exclude: ['.worktrees/**', 'node_modules/**'],
        },
      },
      {
        test: {
          name: 'web',
          include: ['apps/web/src/**/*.test.ts'],
          exclude: ['.worktrees/**', 'node_modules/**'],
        },
      },
    ],
  },
});
