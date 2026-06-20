// apps/web/src/app/(authenticated)/admin/producers/page.tsx
//
// Card 0.16 — Producers list view. Server Component.

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
import { listProducers } from './actions';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams?: Record<string, string | string[] | undefined>;
}

export default async function ProducersListPage({
  searchParams,
}: PageProps): Promise<React.ReactElement> {
  const ctx = await requireAdminContext();
  const params = parseListParams(searchParams, {
    pageSize: 25,
    sortColumn: 'name',
    sortDir: 'asc',
  });

  let rows: Awaited<ReturnType<typeof listProducers>>['rows'];
  let total = 0;
  let loadError: string | null = null;
  try {
    const result = await listProducers(
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
          title="Producers"
          newHref="/admin/producers/new"
          entity="producer"
          role={ctx.role}
          total={0}
          searchValue={params.search}
        />
        <ListError message={loadError} retryHref="/admin/producers" />
      </>
    );
  }

  if (total === 0 && params.search === '') {
    return (
      <>
        <AdminToolbar
          title="Producers"
          newHref="/admin/producers/new"
          entity="producer"
          role={ctx.role}
          total={0}
          searchValue={params.search}
        />
        <EmptyState
          title="No producers yet"
          description="Producers are the farms and cooperatives where the green coffee is grown. Each carries a country, region, geolocation, and verification source."
          ctaHref="/admin/producers/new"
          ctaLabel="Create your first producer"
          entity="producer"
          role={ctx.role}
        />
      </>
    );
  }

  return (
    <>
      <AdminToolbar
        title="Producers"
        newHref="/admin/producers/new"
        entity="producer"
        role={ctx.role}
        total={total}
        searchValue={params.search}
        searchPlaceholder="Search name, country, region…"
      />
      <div style={tableWrapStyle}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Name</th>
              <th style={thStyle}>Country</th>
              <th style={thStyle}>Region</th>
              <th style={thStyle}>Area (ha)</th>
              <th style={thStyle}>Verification</th>
              <th style={thStyle}>Geolocation</th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td style={tdStyle}>
                  <Link
                    href={`/admin/producers/${row.id}`}
                    style={tableLinkStyle}
                  >
                    {row.name}
                  </Link>
                </td>
                <td style={tdStyle}>{row.country_code}</td>
                <td style={tdStyle}>{row.region ?? '—'}</td>
                <td style={tdStyle}>{row.area_hectares ?? '—'}</td>
                <td style={tdStyle}>{row.verification_source}</td>
                <td style={tdStyle}>{row.has_geolocation ? '✓' : '—'}</td>
                <td style={tdStyle}>
                  <Link
                    href={`/admin/producers/${row.id}`}
                    style={buttonSecondaryStyle}
                  >
                    Edit
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination
        basePath="/admin/producers"
        page={params.page}
        pageSize={params.pageSize}
        total={total}
        search={params.search}
      />
    </>
  );
}
