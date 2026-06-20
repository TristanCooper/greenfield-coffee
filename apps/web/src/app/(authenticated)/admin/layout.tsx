// apps/web/src/app/(authenticated)/admin/layout.tsx
//
// Card 0.16 / plan §7.4 — shared layout for the admin section.
//
// The admin section is a "settings" area — CRUD over reference data.
// Every page under /(authenticated)/admin/* renders inside this
// layout so the navigation bar (and the page-level gate) is shared.
//
// AUTH GATE
//
//   requireAdminContext() runs once per request, BEFORE the page
//   component renders. The page component is a child of this layout
//   so the layout's gate also protects the page. If the user is
//   unauthenticated / has no membership / no org, the layout
//   redirects and the page never runs.
//
//   Inlining the gate in the layout (vs. every page) keeps the
//   gate logic DRY across 7+ entity pages. We deliberately DON'T
//   enforce role-based access at the layout level — the per-page
//   navigation links hide entries the user can't access, and the
//   per-form server actions enforce the role check. The layout
//   just says "is this user in an admin-eligible context?"
//
// NAVIGATION
//
//   The nav links point at every entity's list view. The links are
//   rendered unconditionally — server-side page-level gating hides
//   entities the user can't access at all (e.g. readonly sees only
//   the read-only entities). For v0 every entity is read-accessible
//   to every role, so all links show for everyone. The link to a
//   page with no role privileges would just render a read-only list.
//   A future card can add a "no write access" badge.

import type { ReactElement, ReactNode } from 'react';
import { requireAdminContext } from '@/lib/admin/server';
import {
  pageStyle,
  pageInnerStyle,
  headerStyle,
  h1Style,
  subheadStyle,
} from '@/lib/admin/styles';
import { AdminNav } from './AdminNav';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}): Promise<ReactElement> {
  const ctx = await requireAdminContext();

  return (
    <main style={pageStyle}>
      <div style={pageInnerStyle}>
        <header style={headerStyle}>
          <div>
            <h1 style={h1Style}>Admin</h1>
            <p style={subheadStyle}>
              Reference data for {ctx.orgName}. Signed in as {ctx.userEmail}{' '}
              ({ctx.role}).
            </p>
          </div>
        </header>
        <AdminNav active={null} />
        {children}
      </div>
    </main>
  );
}
