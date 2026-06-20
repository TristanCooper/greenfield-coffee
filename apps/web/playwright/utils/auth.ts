// apps/web/playwright/utils/auth.ts
//
// Card 13 / magic-link auth helper for Playwright tests.
//
// HOW IT WORKS
//
//   The test process navigates the browser to
//   `/api/test/sign-in?email=...&password=...`. The dev server
//   runs the route handler, which uses the publishable key
//   to call `signInWithPassword` against Supabase Auth. On
//   success, the route handler sets the session cookies
//   via @supabase/ssr's setAll — the same path that the
//   production `/auth/callback` route uses after a magic
//   link exchange. The browser ends up with a real session
//   cookie. The test then asserts the cookie is set and
//   navigates to a protected route.
//
// WHY THIS AVOIDS THE SERVICE-ROLE KEY
//
//   Earlier versions used `supabase.auth.admin.generateLink`
//   which requires the service-role key. That key is a
//   long-lived bearer token with full DB access — a
//   "legacy" way of doing test auth. The modern pattern
//   is to use the publishable key for user-level auth
//   (signInWithPassword) and direct SQL for user creation
//   (handled in global-setup.ts). No admin key required.
//
//   The test-only `/api/test/sign-in` route is gated on
//   `NODE_ENV !== 'production'` so it 404s in prod.
//
// RETURN TYPE
//
//   The helper returns void. After the call, the test
//   process's browser has the session cookies. Follow-up
//   navigations are authenticated.

import type { Page } from '@playwright/test';
import 'dotenv/config';

const TEST_USER_EMAIL =
  process.env.PLAYWRIGHT_TEST_USER_EMAIL ??
  'playwright-test@greenfield.example';
const TEST_USER_PASSWORD =
  process.env.PLAYWRIGHT_TEST_USER_PASSWORD ??
  'test-password-do-not-use-in-prod';

/**
 * Sign the browser in as the test user. After this call,
 * the test's browser has a valid Supabase session cookie
 * and follow-up navigations to protected routes succeed.
 */
export async function signInAsTestUser(
  page: Page,
  baseURL: string,
): Promise<void> {
  // POST would be more RESTful; the route uses GET for
  // simplicity (no body parsing) and because the credentials
  // are URL-encoded query params (in dev only). The dev
  // server doesn't log query params, but we still avoid
  // logging anything from this path.
  const url = new URL('/api/test/sign-in', baseURL);
  url.searchParams.set('email', TEST_USER_EMAIL);
  url.searchParams.set('password', TEST_USER_PASSWORD);

  const response = await page.goto(url.toString(), { waitUntil: 'load' });
  if (!response) {
    throw new Error('signInAsTestUser: no response from /api/test/sign-in');
  }
  if (response.status() !== 200) {
    const body = await response.text().catch(() => '<unreadable>');
    throw new Error(
      `signInAsTestUser: /api/test/sign-in returned ${response.status()}: ${body}`,
    );
  }
}
