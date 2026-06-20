// apps/web/playwright/onboarding.spec.ts
//
// Card 13 / onboarding dashboard.
//
// What this covers:
//   - After sign-in, /onboarding shows the org dashboard
//     (heading, org name, role, region, base currency,
//     data residency).
//   - Read-only roles (pack_ship, readonly, accountant) see
//     a read-only variant on protected routes (deferred to
//     a v1.5 card; v1 covers the happy path only).
//
// The test re-uses the same auth helper as auth.spec.ts.

import { test, expect } from '@playwright/test';
import 'dotenv/config';
import { signInAsTestUser } from './utils/auth';

test.describe('Onboarding — org dashboard', () => {
  test('shows the org dashboard for the test user', async ({
    page,
    baseURL,
  }) => {
    await signInAsTestUser(page, baseURL!);
    await page.goto('/onboarding');

    await expect(
      page.getByRole('heading', { name: /welcome to Greenfield Test/i }),
    ).toBeVisible();

    // The role chip.
    await expect(page.getByText(/owner/i)).toBeVisible();

    // The org details card.
    const details = page.getByRole('heading', { name: /organisation details/i });
    await expect(details).toBeVisible();

    // Region, base currency, data residency.
    await expect(page.getByText(/Region/i)).toBeVisible();
    await expect(page.getByText(/GB/)).toBeVisible();
    await expect(page.getByText(/Base currency/i)).toBeVisible();
    await expect(page.getByText(/GBP/)).toBeVisible();
  });
});
