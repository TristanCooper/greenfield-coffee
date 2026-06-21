// apps/web/src/app/(authenticated)/admin/price-lists/page.tsx
//
// Card 0.16 — Price lists list view. Server Component.

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
import { listPriceLists } from './actions';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams?: Record<string, string | string[] | undefined>;
}

export default async function PriceListsListPage({
  searchParams,
}: PageProps): Promise<React.ReactElement> {
  const ctx = await requireAdminContext();
  const params = parseListParams(searchParams, {
    pageSize: 25,
    sortColumn: 'code',
    sortDir: 'asc',
  });

  let rows: Awaited<ReturnType<typeof listPriceLists>>['rows'];
  let total = 0;
  let loadError: string | null = null;
  try {
    const result = await listPriceLists(
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
          title="Price lists"
          newHref="/admin/price-lists/new"
          entity="price_list"
          role={ctx.role}
          total={0}
          searchValue={params.search}
        />
        <ListError message={loadError} retryHref="/admin/price-lists" />
      </>
    );
  }

  if (total === 0 && params.search === '') {
    return (
      <>
        <AdminToolbar
          title="Price lists"
          newHref="/admin/price-lists/new"
          entity="price_list"
          role={ctx.role}
          total={0}
          searchValue={params.search}
        />
        <EmptyState
          title="No price lists yet"
          description="Price lists are per-SKU pricing — retail, wholesale, promo. VAT modes (inclusive/exclusive) and per-SKU rate overrides."
          ctaHref="/admin/price-lists/new"
          ctaLabel="Create your first price list"
          entity="price_list"
          role={ctx.role}
        />
      </>
    );
  }

  return (
    <>
      <AdminToolbar
        title="Price lists"
        newHref="/admin/price-lists/new"
        entity="price_list"
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
              <th style={thStyle}>Kind</th>
              <th style={thStyle}>VAT mode</th>
              <th style={thStyle}>Currency</th>
              <th style={thStyle}>VAT %</th>
              <th style={thStyle}>Entries</th>
              <th style={thStyle}>Active</th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td style={tdStyle}>
                  <Link
                    href={`/admin/price-lists/${row.id}`}
                    style={tableLinkStyle}
                  >
                    {row.code}
                  </Link>
                </td>
                <td style={tdStyle}>{row.name}</td>
                <td style={tdStyle}>{row.kind}</td>
                <td style={tdStyle}>{row.vat_mode}</td>
                <td style={tdStyle}>{row.currency_code}</td>
                <td style={tdStyle}>{row.vat_rate_pct ?? '—'}</td>
                <td style={tdStyle}>{row.entry_count}</td>
                <td style={tdStyle}>{row.active ? 'Yes' : 'No'}</td>
                <td style={tdStyle}>
                  <Link
                    href={`/admin/price-lists/${row.id}`}
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
        basePath="/admin/price-lists"
        page={params.page}
        pageSize={params.pageSize}
        total={total}
        search={params.search}
      />
    </>
  );
}
