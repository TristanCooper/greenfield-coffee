// apps/web/playwright/utils/auth.ts
//
// Card 13 / magic-link auth helper for Playwright tests.
//
// WHY A CUSTOM HELPER
//
//   The card body for 0.5 sends a magic link via Supabase
//   auth's email flow. A test that waits for the email
//   (via Mailosaur / Mailtrap / Resend test mode) is the
//   real way to exercise the flow end-to-end, but the
//   infra isn't wired yet. The v1 helper skips the email
//   round-trip: it asks Supabase's admin API to generate a
//   magic link server-side, extracts the verification
//   `code` from the resulting `action_link`, and visits
//   `/auth/callback?code=…` to set the session cookie.
//
// HOW IT WORKS
//
//   1. `supabase.auth.admin.generateLink({ type: 'magiclink',
//      email, options: { redirectTo: <baseURL>/auth/callback }})`
//      returns `{ data: { properties: { action_link: string } } }`.
//   2. Parse the `code` query param from the `action_link`.
//   3. `page.goto('<baseURL>/auth/callback?code=…')` — the
//      route handler exchanges the code and sets the
//      cookies.
//   4. The page is now authenticated.
//
//   The session cookie is httpOnly + signed by Supabase;
//   Playwright's `context.cookies()` exposes it. The
//   follow-up navigations (`page.goto('/onboarding')`, etc.)
//   use the cookie automatically.
//
// CAVEAT
//
//   The admin `generateLink` is the same API the card
//   0.17 testing approach would use. It exercises the
//   Supabase auth flow end-to-end (the token is generated
//   server-side, the action_link goes through the
//   Supabase-hosted verify endpoint, and the redirect to
//   `/auth/callback` is real). The only thing it skips is
//   the user's email client — the link never lands in
//   an inbox.

import { createClient } from '@supabase/supabase-js';
import type { Page, BrowserContext } from '@playwright/test';
import 'dotenv/config';

// Env vars are read lazily inside the helpers, not at
// module import time. The spec files import this module at
// collection time (e.g. for `playwright --list`), and we
// don't want the missing-env error to fire before the
// global setup has validated everything.

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `Missing env var ${name}; required by the playwright auth helper.`,
    );
  }
  return v;
}

/**
 * Sign a page in as the test user via the magic-link flow.
 * Mutates the page's context: cookies are set so subsequent
 * navigations are authenticated.
 */
export async function signInAsTestUser(
  page: Page,
  baseURL: string,
): Promise<void> {
  const sb = createClient(
    mustEnv('NEXT_PUBLIC_SUPABASE_URL'),
    mustEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const { data, error } = await sb.auth.admin.generateLink({
    type: 'magiclink',
    email: process.env.PLAYWRIGHT_TEST_USER_EMAIL ??
      'playwright-test@greenfield.example',
    options: {
      redirectTo: `${baseURL}/auth/callback`,
    },
  });
  if (error) {
    throw new Error(`generateLink failed: ${error.message}`);
  }
  const actionLink = data?.properties?.action_link;
  if (!actionLink) {
    throw new Error('generateLink returned no action_link');
  }

  // Parse the `code` query param from the action_link. The
  // link looks like:
  //   https://<project>.supabase.co/auth/v1/verify?token=...&type=magiclink&redirect_to=...&code=<code>
  // The PKCE flow surfaces the `code` directly; the legacy
  // OTP flow uses `token` (and the Supabase auth domain
  // exchanges it for a `code` server-side before redirecting).
  // We handle both.
  const url = new URL(actionLink);
  let code = url.searchParams.get('code');
  if (!code) {
    const token = url.searchParams.get('token');
    if (!token) {
      throw new Error(
        `action_link has no code or token: ${actionLink.slice(0, 200)}…`,
      );
    }
    // The Supabase auth domain's /verify endpoint will
    // exchange the token for a code. Visit the FULL
    // action_link in the browser so the Supabase auth
    // domain runs its verify logic, then we land on
    // /auth/callback?code=… with the session cookie.
    await page.goto(actionLink, { waitUntil: 'load' });
    return;
  }

  // Direct code path: visit the callback with the code.
  await page.goto(
    `${baseURL}/auth/callback?code=${encodeURIComponent(code)}`,
    { waitUntil: 'load' },
  );
}

/**
 * Sign out by clearing cookies. Use between tests if a
 * fixture needs a clean unauthenticated state. (The
 * receiving-green test doesn't need this — it stays
 * signed in throughout.)
 */
export async function signOut(context: BrowserContext): Promise<void> {
  await context.clearCookies();
}
