// apps/web/src/app/(authenticated)/receiving/green/new/page.tsx
//
// Card 0.17 / plan §7.4 — "Receive green lot" form landing page.
//
// The page is a Server Component that gates on:
//   1. Authenticated session (redirects to /login if missing).
//   2. RBAC role (owner / head_roaster / buyer_receiving /
//      compliance_officer can submit; pack_ship / readonly /
//      accountant see read-only).
//
// The page renders the GreenReceivingWizard client component
// with the org context. The wizard owns the form state and the
// step navigation; the page is a thin gate.
//
// ROUTE
//
//   /receiving/green/new
//
// Post-submit the wizard redirects to /receiving/green/[id]
// (the lot detail page). The detail page is added in this card.

import { redirect } from 'next/navigation';
import type { ReactElement } from 'react';
import { createClient } from '@/lib/supabase/server';
import { getFirstMembership, unscopedDb } from '@greenfield/db';
import { GreenReceivingWizard } from './GreenReceivingWizard';

export const dynamic = 'force-dynamic';

interface OrgSummary {
  id: string;
  name: string;
  base_currency: string;
  region: string;
}

const SUBMIT_ROLES = new Set([
  'owner',
  'head_roaster',
  'buyer_receiving',
  'compliance_officer',
]);

async function fetchOrgSummary(orgId: string): Promise<OrgSummary | null> {
  const rows = await unscopedDb<OrgSummary>(
    `SELECT id, name, base_currency, region
       FROM public.organizations
      WHERE id = $1
      LIMIT 1`,
    orgId,
  );
  return rows[0] ?? null;
}

export default async function NewGreenLotPage(): Promise<ReactElement> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect('/login?next=/receiving/green/new');
  }

  const membership = await getFirstMembership(user.id);
  if (!membership) {
    redirect('/signup');
  }

  const org = await fetchOrgSummary(membership.org_id);
  if (!org) {
    // The membership points at an org that doesn't exist. This
    // shouldn't happen (FK ON DELETE CASCADE on memberships
    // → organizations is RESTRICT, see 0003_organizations),
    // but a defensive redirect is better than a crash.
    redirect('/onboarding');
  }

  const canSubmit = SUBMIT_ROLES.has(membership.role);

  return (
    <GreenReceivingWizard
      orgId={org.id}
      orgName={org.name}
      baseCurrency={org.base_currency}
      userId={user.id}
      userEmail={user.email ?? ''}
      canSubmit={canSubmit}
    />
  );
}
