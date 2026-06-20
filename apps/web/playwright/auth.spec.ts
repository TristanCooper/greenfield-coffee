// apps/web/playwright/auth.spec.ts
//
// Card 13 / auth happy path.
//
// What's covered:
//   - The /api/test/sign-in route successfully signs in
//     the test user (publishable key + signInWithPassword)
//     and sets the session cookies via @supabase/ssr.
//   - The session cookie is recognized by protected routes
//     (/onboarding).
//   - Unauthenticated users get redirected from /onboarding
//     to /login.

import { test, expect } from '@playwright/test';
import 'dotenv/config';
import { signInAsTestUser } from './utils/auth';

test.describe('Auth — sign-in via test route', () => {
  test('signs in and reaches a protected route', async ({
    page,
    baseURL,
  }) => {
    // Drive the auth flow via the helper. The helper
    // navigates the browser to /api/test/sign-in, which
    // signs in the test user and sets the session cookies
    // via @supabase/ssr's setAll. After this, the browser
    // is authenticated for subsequent navigations.
    await signInAsTestUser(page, baseURL!);

    // /onboarding is the post-auth landing. With a valid
    // session AND a membership, the page shows the
    // "Welcome to <org name>" screen.
    await page.goto('/onboarding');
    await expect(
      page.getByRole('heading', { name: /welcome to Greenfield Test/i }),
    ).toBeVisible();
  });

  test('redirects unauthenticated users from /onboarding to /login', async ({
    page,
  }) => {
    // Clear any cookies the test runner set up.
    await page.context().clearCookies();
    await page.goto('/onboarding');
    await expect(page).toHaveURL(/\/login/);
  });
});
