# apps/web/playwright

End-to-end tests for the journeys that exist today. Playwright
config and global setup live in this directory; the runner is
invoked from `apps/web/` via `pnpm test:e2e`.

## What's covered

- `auth.spec.ts` — sign-in via the test-only `/api/test/sign-in`
  route (publishable key + signInWithPassword) + session
  cookie presence + redirect-to-login for unauthenticated
  users.
- `onboarding.spec.ts` — the post-sign-in org dashboard.
- `receiving-green.spec.ts` — the full 5-step green-receiving
  wizard, end-to-end. Asserts the green_lot, supplier,
  producer, eudr_reference_data, landed_cost_event, and
  audit_event rows exist after submit.

## Required env vars

Copy from `.env.example` and fill in. All three are required —
the global setup fails loud if any are missing.

| Env var                                | Used for                                    |
| -------------------------------------- | ------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | The project URL (public to the browser).    |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | The publishable (anon) key.                  |
| `DATABASE_URL`                         | `unscopedDb` for the global setup's user/org creation, the spec files' DB reset, and the post-submit assertions. |

**No service-role key is required.** The test harness does
test-user creation via direct SQL (INSERT INTO auth.users
with bcrypt-hashed password) and test auth via the
publishable key (signInWithPassword). This is the modern
Supabase pattern: no long-lived admin bearer tokens in
the test config.

Optional:

| Env var                       | Used for                                          |
| ----------------------------- | ------------------------------------------------- |
| `PLAYWRIGHT_BASE_URL`         | Override the base URL. Default: `http://localhost:3000`. |
| `PLAYWRIGHT_PORT`             | Override the dev-server port. Default: `3000`.     |
| `PLAYWRIGHT_TEST_USER_EMAIL`  | Override the test user email. Default: `playwright-test@greenfield.example`. |
| `PLAYWRIGHT_TEST_USER_PASSWORD` | Override the test user password. Default: `test-password-do-not-use-in-prod` (placeholder). |

## First-time setup

1. Install Playwright browsers (one-time, ~200MB):

   ```bash
   pnpm --filter @greenfield/web exec playwright install chromium
   ```

2. Add the env vars to `.env` (or your shell):

   ```bash
   NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_<…>
   DATABASE_URL=postgres://…?sslmode=require
   ```

3. Run:

   ```bash
   pnpm --filter @greenfield/web test:e2e
   ```

## What hits your Supabase

The tests run against your **live Supabase project** — the
same one your dev server uses. The test setup:

- Creates a test user (`playwright-test@greenfield.example`)
  via direct SQL (INSERT INTO auth.users with bcrypt-hashed
  password). Idempotent — re-runs reuse the same user.
- Creates a test org named "Greenfield Test" with region GB
  and base currency GBP. Idempotent.
- Adds the test user to the org as `owner`.
- **Truncates the test org's transactional data** between
  runs (audit_event, green_lot, landed_cost_event,
  eudr_reference_data, etc.). Production-shaped data
  (other orgs) is NOT touched.

The test user + org are a known fixture — leaving them in
your project is fine. The transactional data is wiped on
each run, so a re-run always starts clean.

If you want a dedicated test environment (recommended for
serious CI), spin up a separate Supabase project and point
the env vars at it. The test code is environment-agnostic.

## How the auth helper works

The test browser navigates to `/api/test/sign-in?email=…
&password=…`. That route lives at
`apps/web/src/app/api/test/sign-in/route.ts` and:

1. Refuses to run in production (returns 404 if
   `NODE_ENV === 'production'`).
2. Calls `supabase.auth.signInWithPassword` using the
   publishable key (no admin key required).
3. Sets the session cookies via @supabase/ssr's setAll —
   the same path the production `/auth/callback` route uses.

The test browser ends up with a real session cookie. No
magic-link email round-trip, no service-role key.

## Adding a new test

1. Create `apps/web/playwright/<name>.spec.ts`.
2. Sign in with `signInAsTestUser(page, baseURL!)` at the
   top of your test (it sets the cookies on `page.context()`).
3. Drive the UI with Playwright's `page.getByRole` /
   `page.getByLabel` locators (avoid CSS selectors — they
   break when the UI changes).
4. For DB assertions, use `unscopedDb` from `@greenfield/db`
   with positional params (`$1`, `$2`).
5. Mark the file `test.describe('<area> — <what it tests>')`
   so the runner output is scannable.

## Debugging a failing test

- `pnpm --filter @greenfield/web test:e2e:ui` — opens the
  Playwright UI with the trace viewer.
- Trace files land in `apps/web/playwright/test-results/`
  on failure (the config retains traces on first retry).
- The dev-server stdout is piped — it shows in the test
  runner output when tests fail.
- A common cause: stale `.next` build cache. Fix:
  `rm -rf apps/web/.next` and re-run.
