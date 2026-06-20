// apps/web/playwright/auth.spec.ts
//
// Card 13 / auth happy path.
//
// WHAT THIS COVERS
//
//   The user clicks "Send magic link" on /login, the
//   Supabase auth flow runs, the user lands on / with a
//   session cookie, and a follow-up navigation to
//   /onboarding shows the org dashboard (proving the
//   session is real, not a phantom).
//
// HOW IT WORKS
//
//   The auth helper in utils/auth.ts uses Supabase's admin
//   API to generate a magic link, extracts the code, and
//   navigates the browser to /auth/callback?code=… to set
//   the session cookie. We then assert the cookie is
//   present and the protected route is reachable.

import { test, expect } from '@playwright/test';
import 'dotenv/config';
import { signInAsTestUser } from './utils/auth';

test.describe('Auth — magic-link sign-in', () => {
  test('signs in via magic link and reaches the dashboard', async ({
    page,
    baseURL,
  }) => {
    // The login page renders the email form.
    await page.goto('/login');
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(
      page.getByRole('button', { name: /send magic link/i }),
    ).toBeVisible();

    // Drive the auth flow via the helper (bypasses email).
    await signInAsTestUser(page, baseURL!);

    // The callback route should redirect us to /. If the
    // Supabase code exchange failed we'd be at /login.
    await expect(page).toHaveURL(/\/$/);

    // The session cookie is set. The Supabase auth cookie
    // name is `sb-<project-ref>-auth-token` (one chunk
    // per chunked cookie). We don't assert the exact name
    // (it's an implementation detail of @supabase/ssr);
    // we assert that ANY sb- cookie is present.
    const cookies = await page.context().cookies();
    const sbCookies = cookies.filter((c) => c.name.startsWith('sb-'));
    expect(sbCookies.length).toBeGreaterThan(0);

    // /onboarding is the post-auth landing. With a valid
    // session AND a membership, the page shows the
    // "Welcome to <org name>" screen.
    await page.goto('/onboarding');
    await expect(
      page.getByRole('heading', { name: /welcome/i }),
    ).toBeVisible();
    await expect(page.getByText(/Greenfield Test/)).toBeVisible();
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
