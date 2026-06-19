// apps/web/src/app/signup/page.tsx
//
// Organisation-creation page (post-auth).
//
// Card 0.7.
//
// Flow:
//   - User signs in via /login (magic-link)
//   - Lands on /auth/callback → cookie set, redirected to / (or `?next=`)
//   - The /onboarding route (see apps/web/src/app/(authenticated)/onboarding/page.tsx)
//     checks for a membership; if none, redirects here.
//   - The user fills out the form, submits to /api/organizations, gets
//     redirected back to /onboarding, which now sees a membership and
//     routes to the org dashboard.
//
// Server Component shell only — the actual form is the Client Component
// SignupForm below. The Server Component's job here is just the
// metadata + outer layout.

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { ReactElement } from 'react';
import { createClient } from '@/lib/supabase/server';
import {
  getFirstMembership,
  REGION_TO_COUNTRIES,
  SUPPORTED_BASE_CURRENCIES,
  UK_EU_REGIONS,
} from '@greenfield/db';
import { SignupForm } from './SignupForm';

export const metadata: Metadata = {
  title: 'Create organisation — Greenfield',
};

export const dynamic = 'force-dynamic';

export default async function SignupPage(): Promise<ReactElement> {
  // Defence-in-depth: if the user lands here while ALREADY owning an
  // org, send them to /onboarding which will route them to the
  // dashboard. The /onboarding route is the canonical "where do I
  // go from here" gate; this is just an early-out so a stale
  // /signup link doesn't make the user fill the form for nothing.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    const m = await getFirstMembership(user.id);
    if (m) redirect('/onboarding');
  }

  // Pull client-safe constants from the @greenfield/db barrel and
  // hand them to the SignupForm via props. The barrel also exports
  // the postgres-js `db` client (Node-only); keeping the client
  // bundle out of the barrel avoids webpack trying to bundle
  // `fs` / `perf_hooks` into the browser. See SignupForm.tsx for
  // the full rationale.
  const countryCodes = Object.keys(UK_EU_REGIONS) as (keyof typeof UK_EU_REGIONS)[];

  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        padding: '2rem',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div style={{ width: '100%', maxWidth: 460 }}>
        <h1 style={{ margin: '0 0 0.5rem' }}>Create your organisation</h1>
        <p style={{ color: '#555', marginTop: 0 }}>
          Set up the workspace for your roastery. You can change most
          settings later.
        </p>
        <SignupForm
          countryCodes={countryCodes}
          baseCurrencies={SUPPORTED_BASE_CURRENCIES}
          regionCountries={REGION_TO_COUNTRIES}
        />
      </div>
    </main>
  );
}