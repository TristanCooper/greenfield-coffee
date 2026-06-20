// apps/web/src/app/(authenticated)/admin/suppliers/page.tsx
//
// Card 0.16 — Suppliers list view. Server Component.

import Link from 'next/link';
import {
  requireAdminContext,
  parseListParams,
} from '@/lib/admin/server';
import {
  tableWrapStyle,
  tableStyle,
  thStyle,
  tdStyle,
  tableLinkStyle,
  buttonSecondaryStyle,
} from '@/lib/admin/styles';
import { AdminToolbar } from '../_components/AdminToolbar';
import { EmptyState, ListError } from '../_components/AdminListStates';
import { Pagination } from '../_components/Pagination';
import { listSuppliers } from './actions';
import { readRiskAssessment } from './risk-assessment';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams?: Record<string, string | string[] | undefined>;
}

export default async function SuppliersListPage({
  searchParams,
}: PageProps): Promise<React.ReactElement> {
  const ctx = await requireAdminContext();
  const params = parseListParams(searchParams, {
    pageSize: 25,
    sortColumn: 'name',
    sortDir: 'asc',
  });

  let rows: Awaited<ReturnType<typeof listSuppliers>>['rows'];
  let total = 0;
  let loadError: string | null = null;
  try {
    const result = await listSuppliers(
      ctx.orgId,
      params.page,
      params.pageSize,
      params.search,
    );
    rows = result.rows;
    total = result.total;
  } catch (e) {
    loadError = e instanceof Error ? e.message : 'Unknown error';
    rows = [];
  }

  if (loadError) {
    return (
      <>
        <AdminToolbar
          title="Suppliers"
          newHref="/admin/suppliers/new"
          entity="supplier"
          role={ctx.role}
          total={0}
          searchValue={params.search}
        />
        <ListError message={loadError} retryHref="/admin/suppliers" />
      </>
    );
  }

  if (total === 0 && params.search === '') {
    return (
      <>
        <AdminToolbar
          title="Suppliers"
          newHref="/admin/suppliers/new"
          entity="supplier"
          role={ctx.role}
          total={0}
          searchValue={params.search}
        />
        <EmptyState
          title="No suppliers yet"
          description="Suppliers are the upstream sellers of green coffee. Each carries a country, EORI, DDS reference, and a structured EUDR risk assessment."
          ctaHref="/admin/suppliers/new"
          ctaLabel="Create your first supplier"
          entity="supplier"
          role={ctx.role}
        />
      </>
    );
  }

  return (
    <>
      <AdminToolbar
        title="Suppliers"
        newHref="/admin/suppliers/new"
        entity="supplier"
        role={ctx.role}
        total={total}
        searchValue={params.search}
        searchPlaceholder="Search name or country…"
      />
      <div style={tableWrapStyle}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Name</th>
              <th style={thStyle}>Country</th>
              <th style={thStyle}>EORI</th>
              <th style={thStyle}>Overall risk</th>
              <th style={thStyle}>Last reviewed</th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const risk = readRiskAssessment(row.risk_assessment);
              return (
                <tr key={row.id}>
                  <td style={tdStyle}>
                    <Link
                      href={`/admin/suppliers/${row.id}`}
                      style={tableLinkStyle}
                    >
                      {row.name}
                    </Link>
                  </td>
                  <td style={tdStyle}>{row.country_code}</td>
                  <td style={tdStyle}>{row.eori ?? '—'}</td>
                  <td style={tdStyle}>{risk.overall_risk}</td>
                  <td style={tdStyle}>{risk.last_reviewed_at ?? '—'}</td>
                  <td style={tdStyle}>
                    <Link
                      href={`/admin/suppliers/${row.id}`}
                      style={buttonSecondaryStyle}
                    >
                      Edit
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pagination
        basePath="/admin/suppliers"
        page={params.page}
        pageSize={params.pageSize}
        total={total}
        search={params.search}
      />
    </>
  );
}
