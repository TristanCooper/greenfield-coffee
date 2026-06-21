// apps/web/src/app/(authenticated)/admin/recipes/page.tsx
//
// Card 0.16 — Recipes list view. Server Component.

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
import { listRecipes } from './actions';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams?: Record<string, string | string[] | undefined>;
}

export default async function RecipesListPage({
  searchParams,
}: PageProps): Promise<React.ReactElement> {
  const ctx = await requireAdminContext();
  const params = parseListParams(searchParams, {
    pageSize: 25,
    sortColumn: 'code',
    sortDir: 'asc',
  });

  let rows: Awaited<ReturnType<typeof listRecipes>>['rows'];
  let total = 0;
  let loadError: string | null = null;
  try {
    const result = await listRecipes(
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
          title="Recipes"
          newHref="/admin/recipes/new"
          entity="recipe"
          role={ctx.role}
          total={0}
          searchValue={params.search}
        />
        <ListError message={loadError} retryHref="/admin/recipes" />
      </>
    );
  }

  if (total === 0 && params.search === '') {
    return (
      <>
        <AdminToolbar
          title="Recipes"
          newHref="/admin/recipes/new"
          entity="recipe"
          role={ctx.role}
          total={0}
          searchValue={params.search}
        />
        <EmptyState
          title="No recipes yet"
          description="Recipes are roast profiles — charge weight, target yield, duration, blend components. Once created, they'll show here."
          ctaHref="/admin/recipes/new"
          ctaLabel="Create your first recipe"
          entity="recipe"
          role={ctx.role}
        />
      </>
    );
  }

  return (
    <>
      <AdminToolbar
        title="Recipes"
        newHref="/admin/recipes/new"
        entity="recipe"
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
              <th style={thStyle}>Charge (g)</th>
              <th style={thStyle}>Yield %</th>
              <th style={thStyle}>Duration</th>
              <th style={thStyle}>Components</th>
              <th style={thStyle}>Active</th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td style={tdStyle}>
                  <Link
                    href={`/admin/recipes/${row.id}`}
                    style={tableLinkStyle}
                  >
                    {row.code}
                  </Link>
                </td>
                <td style={tdStyle}>{row.name}</td>
                <td style={tdStyle}>{row.charge_weight_g}</td>
                <td style={tdStyle}>{row.expected_yield_pct ?? '—'}</td>
                <td style={tdStyle}>{formatDuration(row.duration_seconds)}</td>
                <td style={tdStyle}>{row.component_count}</td>
                <td style={tdStyle}>{row.active ? 'Yes' : 'No'}</td>
                <td style={tdStyle}>
                  <Link
                    href={`/admin/recipes/${row.id}`}
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
        basePath="/admin/recipes"
        page={params.page}
        pageSize={params.pageSize}
        total={total}
        search={params.search}
      />
    </>
  );
}

function formatDuration(seconds: number): string {
  if (seconds <= 0) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
