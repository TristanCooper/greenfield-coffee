// apps/web/src/app/(authenticated)/receiving/green/[id]/page.tsx
//
// Card 0.17 — green lot detail page (post-submit destination).
//
// After the wizard submits, it redirects to
// /receiving/green/[id]. This page shows the lot's data,
// the EudrReferenceData row (with the computed risk_status
// from the trigger), and the linked supplier / producer
// records.
//
// The page is a Server Component that uses withTenant to
// read the data inside the org's tenant scope.

import { redirect } from 'next/navigation';
import Link from 'next/link';
import type { ReactElement } from 'react';
import { createClient } from '@/lib/supabase/server';
import { getFirstMembership, withTenant } from '@greenfield/db';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

interface GreenLotRow {
  id: string;
  code: string;
  country_of_origin: string;
  harvest_year: number;
  weight_kg: string;
  received_at: string;
  moisture_pct: string | null;
  process: string;
  notes: string | null;
  status: string;
  supplier_id: string | null;
  producer_id: string | null;
  supplier_name: string | null;
  producer_name: string | null;
  producer_country: string | null;
}

interface EudrRefRow {
  risk_status: string;
  factors: {
    supplier_risk: string | null;
    producer_verification: string | null;
    country_risk: string | null;
    notes: string;
  } | null;
  computed_at: string;
}

interface CostLineRow {
  id: string;
  kind: string;
  amount_cents: string;
  currency_code: string;
  vat_recoverable: boolean;
  description: string | null;
}

async function fetchGreenLot(
  orgId: string,
  lotId: string,
): Promise<GreenLotRow | null> {
  const rows = await withTenant(orgId, async (tx) => {
    return [...(await tx<GreenLotRow>`
      SELECT
        gl.id, gl.code, gl.country_of_origin, gl.harvest_year, gl.weight_kg,
        gl.received_at, gl.moisture_pct, gl.process, gl.notes, gl.status,
        gl.supplier_id, gl.producer_id,
        s.name AS supplier_name,
        p.name AS producer_name,
        p.country_code AS producer_country
      FROM public.green_lot gl
      LEFT JOIN public.supplier s ON s.id = gl.supplier_id
      LEFT JOIN public.producer p ON p.id = gl.producer_id
      WHERE gl.id = ${lotId}::uuid
        AND gl.org_id = ${orgId}::uuid
      LIMIT 1
    `)];
  });
  return rows[0] ?? null;
}

async function fetchEudrRef(
  orgId: string,
  lotId: string,
): Promise<EudrRefRow | null> {
  const rows = await withTenant(orgId, async (tx) => {
    return [...(await tx<EudrRefRow>`
      SELECT risk_status, factors, computed_at
        FROM public.eudr_reference_data
       WHERE org_id = ${orgId}::uuid
         AND lot_id = ${lotId}::uuid
       LIMIT 1
    `)];
  });
  return rows[0] ?? null;
}

async function fetchCostLines(
  orgId: string,
  lotId: string,
): Promise<CostLineRow[]> {
  return withTenant(orgId, async (tx) => {
    return [...(await tx<CostLineRow>`
      SELECT id, kind, amount_cents, currency_code, vat_recoverable, description
        FROM public.landed_cost_event
       WHERE org_id = ${orgId}::uuid
         AND green_lot_id = ${lotId}::uuid
       ORDER BY occurred_at DESC
    `)];
  });
}

function riskColor(level: string): string {
  switch (level) {
    case 'high':
      return '#a00';
    case 'medium':
      return '#a60';
    case 'low':
      return '#3a7';
    case 'unassessed':
    default:
      return '#888';
  }
}

export default async function GreenLotDetailPage(
  props: PageProps,
): Promise<ReactElement> {
  const { id } = await props.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/login?next=/receiving/green/${id}`);
  }
  const membership = await getFirstMembership(user.id);
  if (!membership) {
    redirect('/signup');
  }

  const [lot, eudr, costs] = await Promise.all([
    fetchGreenLot(membership.org_id, id),
    fetchEudrRef(membership.org_id, id),
    fetchCostLines(membership.org_id, id),
  ]);

  if (!lot) {
    return (
      <main style={mainStyle}>
        <h1>Green lot not found</h1>
        <p>The lot {id} doesn't exist or you don't have access.</p>
        <p>
          <Link href="/onboarding">← Back to dashboard</Link>
        </p>
      </main>
    );
  }

  return (
    <main style={mainStyle}>
      <header style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ margin: '0 0 0.25rem' }}>{lot.code}</h1>
        <p style={{ color: '#555', margin: 0 }}>
          Green lot · {lot.country_of_origin} · {lot.harvest_year} ·{' '}
          {parseFloat(lot.weight_kg).toFixed(1)} kg
        </p>
      </header>

      <section style={cardStyle}>
        <h2 style={sectionHeaderStyle}>Lot details</h2>
        <dl style={dlStyle}>
          <dt>Code</dt>
          <dd>{lot.code}</dd>
          <dt>Status</dt>
          <dd>{lot.status}</dd>
          <dt>Country of origin</dt>
          <dd>{lot.country_of_origin}</dd>
          <dt>Harvest year</dt>
          <dd>{lot.harvest_year}</dd>
          <dt>Weight received</dt>
          <dd>{parseFloat(lot.weight_kg).toFixed(3)} kg</dd>
          {lot.moisture_pct && (
            <>
              <dt>Moisture</dt>
              <dd>{parseFloat(lot.moisture_pct).toFixed(1)}%</dd>
            </>
          )}
          <dt>Process</dt>
          <dd>{lot.process}</dd>
          {lot.notes && (
            <>
              <dt>Notes</dt>
              <dd>{lot.notes}</dd>
            </>
          )}
          <dt>Received at</dt>
          <dd>{new Date(lot.received_at).toLocaleString()}</dd>
        </dl>
      </section>

      <section style={cardStyle}>
        <h2 style={sectionHeaderStyle}>Supplier</h2>
        <p>
          <strong>{lot.supplier_name ?? '(none)'}</strong>
        </p>
      </section>

      <section style={cardStyle}>
        <h2 style={sectionHeaderStyle}>Producer</h2>
        <p>
          <strong>{lot.producer_name ?? '(none)'}</strong>
          {lot.producer_country ? ` · ${lot.producer_country}` : ''}
        </p>
      </section>

      {eudr && (
        <section style={cardStyle}>
          <h2 style={sectionHeaderStyle}>EUDR risk</h2>
          <p>
            <span
              style={{
                fontWeight: 600,
                color: riskColor(eudr.risk_status),
              }}
            >
              {eudr.risk_status.toUpperCase()}
            </span>{' '}
            <span style={{ color: '#888', fontSize: '0.85rem' }}>
              (computed {new Date(eudr.computed_at).toLocaleString()})
            </span>
          </p>
          {eudr.factors && (
            <dl style={dlStyle}>
              {eudr.factors.supplier_risk && (
                <>
                  <dt>Supplier risk</dt>
                  <dd>{eudr.factors.supplier_risk}</dd>
                </>
              )}
              {eudr.factors.producer_verification && (
                <>
                  <dt>Producer verification</dt>
                  <dd>{eudr.factors.producer_verification}</dd>
                </>
              )}
              {eudr.factors.country_risk && (
                <>
                  <dt>Country risk</dt>
                  <dd>{eudr.factors.country_risk}</dd>
                </>
              )}
              {eudr.factors.notes && (
                <>
                  <dt>Notes</dt>
                  <dd>{eudr.factors.notes}</dd>
                </>
              )}
            </dl>
          )}
        </section>
      )}

      <section style={cardStyle}>
        <h2 style={sectionHeaderStyle}>Cost lines ({costs.length})</h2>
        {costs.length === 0 ? (
          <p>No cost lines recorded.</p>
        ) : (
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Kind</th>
                <th style={thStyle}>Amount</th>
                <th style={thStyle}>Currency</th>
                <th style={thStyle}>VAT</th>
                <th style={thStyle}>Description</th>
              </tr>
            </thead>
            <tbody>
              {costs.map((c) => (
                <tr key={c.id}>
                  <td style={tdStyle}>{c.kind}</td>
                  <td style={tdStyle}>
                    {(parseFloat(c.amount_cents) / 100).toFixed(2)}
                  </td>
                  <td style={tdStyle}>{c.currency_code}</td>
                  <td style={tdStyle}>
                    {c.vat_recoverable ? 'Recoverable' : 'Cost'}
                  </td>
                  <td style={tdStyle}>{c.description ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <p style={{ marginTop: '2rem' }}>
        <Link href="/onboarding">← Back to dashboard</Link>
      </p>
    </main>
  );
}

const mainStyle: React.CSSProperties = {
  padding: '1.5rem',
  fontFamily: 'system-ui, sans-serif',
  maxWidth: 720,
  margin: '0 auto',
  color: '#111',
};

const cardStyle: React.CSSProperties = {
  padding: '1rem 1.25rem',
  border: '1px solid #e5e5e5',
  borderRadius: 8,
  background: '#fff',
  marginBottom: '1rem',
};

const sectionHeaderStyle: React.CSSProperties = {
  margin: '0 0 0.5rem',
  fontSize: '1.05rem',
};

const dlStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'max-content 1fr',
  gap: '0.25rem 1rem',
  margin: 0,
};

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '0.9rem',
};

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '0.4rem 0.5rem',
  borderBottom: '1px solid #ddd',
  fontWeight: 600,
};

const tdStyle: React.CSSProperties = {
  padding: '0.4rem 0.5rem',
  borderBottom: '1px solid #eee',
};
