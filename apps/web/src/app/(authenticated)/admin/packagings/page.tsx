// apps/web/src/app/(authenticated)/admin/packagings/page.tsx
//
// Card 0.16 — Packagings list view. Server Component.

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
import { listPackagings } from './actions';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams?: Record<string, string | string[] | undefined>;
}

export default async function PackagingsListPage({
  searchParams,
}: PageProps): Promise<React.ReactElement> {
  const ctx = await requireAdminContext();
  const params = parseListParams(searchParams, {
    pageSize: 25,
    sortColumn: 'code',
    sortDir: 'asc',
  });

  let rows: Awaited<ReturnType<typeof listPackagings>>['rows'];
  let total = 0;
  let loadError: string | null = null;
  try {
    const result = await listPackagings(
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
          title="Packagings"
          newHref="/admin/packagings/new"
          entity="packaging"
          role={ctx.role}
          total={0}
          searchValue={params.search}
        />
        <ListError message={loadError} retryHref="/admin/packagings" />
      </>
    );
  }

  if (total === 0 && params.search === '') {
    return (
      <>
        <AdminToolbar
          title="Packagings"
          newHref="/admin/packagings/new"
          entity="packaging"
          role={ctx.role}
          total={0}
          searchValue={params.search}
        />
        <EmptyState
          title="No packagings yet"
          description="Packagings are the physical containers SKUs ship in — bags, cases, tins. Once created, they'll show here."
          ctaHref="/admin/packagings/new"
          ctaLabel="Create your first packaging"
          entity="packaging"
          role={ctx.role}
        />
      </>
    );
  }

  return (
    <>
      <AdminToolbar
        title="Packagings"
        newHref="/admin/packagings/new"
        entity="packaging"
        role={ctx.role}
        total={total}
        searchValue={params.search}
        searchPlaceholder="Search code or name…"
      />
      <div style={tableWrapStyle}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Code</th>
              <th style={thStyle}>Name</th>
              <th style={thStyle}>Material</th>
              <th style={thStyle}>Tare (g)</th>
              <th style={thStyle}>Capacity (g)</th>
              <th style={thStyle}>Cost (minor)</th>
              <th style={thStyle}>Active</th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td style={tdStyle}>
                  <Link
                    href={`/admin/packagings/${row.id}`}
                    style={tableLinkStyle}
                  >
                    {row.code}
                  </Link>
                </td>
                <td style={tdStyle}>{row.name}</td>
                <td style={tdStyle}>{row.material}</td>
                <td style={tdStyle}>{row.tare_weight_g}</td>
                <td style={tdStyle}>{row.capacity_g}</td>
                <td style={tdStyle}>{row.cost_minor_units}</td>
                <td style={tdStyle}>{row.active ? 'Yes' : 'No'}</td>
                <td style={tdStyle}>
                  <Link
                    href={`/admin/packagings/${row.id}`}
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
        basePath="/admin/packagings"
        page={params.page}
        pageSize={params.pageSize}
        total={total}
        search={params.search}
      />
    </>
  );
}
