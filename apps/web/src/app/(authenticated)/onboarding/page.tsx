// apps/web/src/app/(authenticated)/onboarding/page.tsx
//
// Post-auth routing gate.
//
// Card 0.7.
//
// Behaviour:
//   1. If the user has no Supabase session → redirect to /login.
//   2. If the user has a session but no Membership → redirect to
//      /signup (the org-creation page).
//   3. If the user has a session and at least one Membership → show
//      a minimal org dashboard ("Welcome to <org name>"). Real
//      dashboard widgets land in Phase 1 / Phase 0.4.
//
// The route lives under the (authenticated) route group so any
// future shared layout (sidebar, top nav, etc.) can be added at the
// group level without touching individual pages. The group has no
// layout.tsx of its own yet — that lands with the first dashboard
// widget.
//
// WHY THIS IS A SERVER COMPONENT:
//   The membership lookup uses the BYPASSRLS postgres role via
//   `getFirstMembership` from @greenfield/db. The query MUST run on
//   the server (the DB connection string is not exposed to the
//   browser). A Client Component could call /api/auth/me and read
//   the result, but the round-trip cost (and the cookie-bound
//   auth context) is unnecessary — the Server Component can read
//   the session directly via createClient().

import { redirect } from 'next/navigation';
import Link from 'next/link';
import type { ReactElement } from 'react';
import { createClient } from '@/lib/supabase/server';
import {
  getFirstMembership,
  getMembership,
  unscopedDb,
} from '@greenfield/db';

export const dynamic = 'force-dynamic';

interface OrgSummary {
  id: string;
  name: string;
  base_currency: string;
  region: string;
}

async function fetchOrgSummary(orgId: string): Promise<OrgSummary | null> {
  // Unscoped read by id — the membership check has already proven the
  // user belongs to this org. Future RLS policies (cards 0.9+)
  // tighten this to a tenant-scoped query.
  const rows = await unscopedDb<OrgSummary>(
    `SELECT id, name, base_currency, region
       FROM public.organizations
      WHERE id = $1
      LIMIT 1`,
    orgId,
  );
  return rows[0] ?? null;
}

export default async function OnboardingPage(): Promise<ReactElement> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // No session → /login (preserves ?next= so the user lands back
  // here after auth).
  if (!user) {
    redirect('/login?next=/onboarding');
  }

  // No membership → /signup (the org-creation form).
  const membership = await getFirstMembership(user.id);
  if (!membership) {
    redirect('/signup');
  }

  // Has a membership → show the dashboard.
  const org = await fetchOrgSummary(membership.org_id);
  // Re-fetch the membership inside the org's tenant scope so the
  // displayed role is what RLS would return. Currently identical to
  // `membership` (no row-level policies yet) but the call site
  // is forward-compatible with the v1 per-membership policies.
  const scopedMembership = await getMembership(user.id, membership.org_id);

  return (
    <main
      style={{
        padding: '2rem',
        fontFamily: 'system-ui, sans-serif',
        maxWidth: 720,
        margin: '0 auto',
      }}
    >
      <h1 style={{ margin: '0 0 0.25rem' }}>
        Welcome{org ? ` to ${org.name}` : ''}
      </h1>
      <p style={{ color: '#555', marginTop: 0 }}>
        You are signed in as <strong>{user.email}</strong> with role{' '}
        <code>{scopedMembership?.role ?? membership.role}</code>.
      </p>

      {org && (
        <section
          style={{
            marginTop: '1.5rem',
            padding: '1rem',
            border: '1px solid #e5e5e5',
            borderRadius: 8,
            background: '#fafafa',
          }}
        >
          <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.05rem' }}>
            Organisation details
          </h2>
          <dl
            style={{
              margin: 0,
              display: 'grid',
              gridTemplateColumns: 'max-content 1fr',
              gap: '0.25rem 1rem',
            }}
          >
            <dt style={{ color: '#666' }}>Name</dt>
            <dd style={{ margin: 0 }}>{org.name}</dd>
            <dt style={{ color: '#666' }}>Region</dt>
            <dd style={{ margin: 0 }}>{org.region}</dd>
            <dt style={{ color: '#666' }}>Base currency</dt>
            <dd style={{ margin: 0 }}>{org.base_currency}</dd>
            <dt style={{ color: '#666' }}>Data residency</dt>
            <dd style={{ margin: 0 }}>uk (single-region, v1)</dd>
          </dl>
        </section>
      )}

      <p style={{ marginTop: '2rem', color: '#666' }}>
        Dashboard widgets (lots, SKUs, daily board) land with Phase 1.
        For now this is the post-sign-up confirmation screen.
      </p>

      <p style={{ marginTop: '1.5rem' }}>
        <Link
          href="/api/auth/diag"
          style={{ color: '#666', fontSize: '0.85rem' }}
        >
          Auth diagnostic →
        </Link>
      </p>
    </main>
  );
}