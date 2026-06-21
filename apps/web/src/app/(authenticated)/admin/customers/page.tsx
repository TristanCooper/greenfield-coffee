// apps/web/src/app/(authenticated)/admin/customers/page.tsx
//
// Card 0.16 — Customers list view. Server Component; mirrors
// apps/web/src/app/(authenticated)/admin/skus/page.tsx.

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
import { listCustomers } from './actions';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams?: Record<string, string | string[] | undefined>;
}

export default async function CustomersListPage({
  searchParams,
}: PageProps): Promise<React.ReactElement> {
  const ctx = await requireAdminContext();
  const params = parseListParams(searchParams, {
    pageSize: 25,
    sortColumn: 'code',
    sortDir: 'asc',
  });

  let rows: Awaited<ReturnType<typeof listCustomers>>['rows'];
  let total = 0;
  let loadError: string | null = null;
  try {
    const result = await listCustomers(
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
          title="Customers"
          newHref="/admin/customers/new"
          entity="customer"
          role={ctx.role}
          total={0}
          searchValue={params.search}
        />
        <ListError message={loadError} retryHref="/admin/customers" />
      </>
    );
  }

  if (total === 0 && params.search === '') {
    return (
      <>
        <AdminToolbar
          title="Customers"
          newHref="/admin/customers/new"
          entity="customer"
          role={ctx.role}
          total={0}
          searchValue={params.search}
        />
        <EmptyState
          title="No customers yet"
          description="Customers are buyers — wholesale accounts, retail regulars, gift-card recipients. Once created, they'll show here for browsing and editing."
          ctaHref="/admin/customers/new"
          ctaLabel="Create your first customer"
          entity="customer"
          role={ctx.role}
        />
      </>
    );
  }

  return (
    <>
      <AdminToolbar
        title="Customers"
        newHref="/admin/customers/new"
        entity="customer"
        role={ctx.role}
        total={total}
        searchValue={params.search}
        searchPlaceholder="Search code, name, or email…"
      />
      <div style={tableWrapStyle}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Code</th>
              <th style={thStyle}>Name</th>
              <th style={thStyle}>Email</th>
              <th style={thStyle}>Country</th>
              <th style={thStyle}>Active</th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td style={tdStyle}>
                  <Link
                    href={`/admin/customers/${row.id}`}
                    style={tableLinkStyle}
                  >
                    {row.code}
                  </Link>
                </td>
                <td style={tdStyle}>{row.name}</td>
                <td style={tdStyle}>{row.email ?? '—'}</td>
                <td style={tdStyle}>{row.country_code ?? '—'}</td>
                <td style={tdStyle}>{row.active ? 'Yes' : 'No'}</td>
                <td style={tdStyle}>
                  <Link
                    href={`/admin/customers/${row.id}`}
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
        basePath="/admin/customers"
        page={params.page}
        pageSize={params.pageSize}
        total={total}
        search={params.search}
      />
    </>
  );
}
