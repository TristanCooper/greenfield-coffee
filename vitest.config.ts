import { defineConfig } from 'vitest/config';

// Root Vitest config: workspace-wide unit test runner.
// Per-package configs (when needed) extend this. For now, the only target
// is packages/*/src/**/*.test.ts; apps/web tests live alongside Next.js
// and use Vitest's jsdom environment in a later card.

export default defineConfig({
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
    ],
  },
});
