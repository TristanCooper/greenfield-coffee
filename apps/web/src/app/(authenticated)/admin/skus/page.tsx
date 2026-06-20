// apps/web/src/app/(authenticated)/admin/skus/page.tsx
//
// Card 0.16 — SKUs list view.
//
// The list view is a Server Component. It runs the auth gate (via
// the admin layout), parses the URL params, queries the SKU table
// inside a tenant transaction, and renders either an empty state,
// the data table, or a load-error state.
//
// The list view deliberately does NOT include the create / edit
// forms inline — those live at /admin/skus/new and
// /admin/skus/[id]/edit. This page is for browsing and the table
// links out to the edit forms.

import Link from 'next/link';
import { requireAdminContext, parseListParams } from '@/lib/admin/server';
import { listSkus } from './actions';
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

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams?: Record<string, string | string[] | undefined>;
}

export default async function SkusListPage({ searchParams }: PageProps): Promise<React.ReactElement> {
  const ctx = await requireAdminContext();
  const params = parseListParams(searchParams, {
    pageSize: 25,
    sortColumn: 'code',
    sortDir: 'asc',
  });

  let rows: Awaited<ReturnType<typeof listSkus>>['rows'];
  let total = 0;
  let loadError: string | null = null;
  try {
    const result = await listSkus(ctx.orgId, params.page, params.pageSize, params.search);
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
          title="SKUs"
          newHref="/admin/skus/new"
          entity="sku"
          role={ctx.role}
          total={0}
          searchValue={params.search}
        />
        <ListError message={loadError} retryHref="/admin/skus" />
      </>
    );
  }

  if (total === 0 && params.search === '') {
    return (
      <>
        <AdminToolbar
          title="SKUs"
          newHref="/admin/skus/new"
          entity="sku"
          role={ctx.role}
          total={0}
          searchValue={params.search}
        />
        <EmptyState
          title="No SKUs yet"
          description="SKUs are your saleable products — bags, cases, gift cards. Once created, they'll show here for browsing and editing."
          ctaHref="/admin/skus/new"
          ctaLabel="Create your first SKU"
          entity="sku"
          role={ctx.role}
        />
      </>
    );
  }

  return (
    <>
      <AdminToolbar
        title="SKUs"
        newHref="/admin/skus/new"
        entity="sku"
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
              <th style={thStyle}>Weight (g)</th>
              <th style={thStyle}>Tags</th>
              <th style={thStyle}>Wholesale only</th>
              <th style={thStyle}>Active</th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td style={tdStyle}>
                  <Link href={`/admin/skus/${row.id}`} style={tableLinkStyle}>
                    {row.code}
                  </Link>
                </td>
                <td style={tdStyle}>{row.name}</td>
                <td style={tdStyle}>{row.unit_weight_g ?? '—'}</td>
                <td style={tdStyle}>
                  {row.tags.length > 0 ? row.tags.join(', ') : '—'}
                </td>
                <td style={tdStyle}>{row.wholesale_only ? 'Yes' : 'No'}</td>
                <td style={tdStyle}>{row.active ? 'Yes' : 'No'}</td>
                <td style={tdStyle}>
                  <Link
                    href={`/admin/skus/${row.id}`}
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
        basePath="/admin/skus"
        page={params.page}
        pageSize={params.pageSize}
        total={total}
        search={params.search}
      />
    </>
  );
}
