// apps/web/src/app/(authenticated)/admin/_components/Pagination.tsx
//
// Card 0.16 — minimal pagination control for admin list views.
//
// Pagination in v0 is intentionally plain: « Prev | Page N of M | Next »
// with a "Go to page" input. No infinite scroll, no jump-to-end. The
// list view passes total + page + pageSize; the component renders
// prev/next links that preserve the current sort + search.

import Link from 'next/link';
import { tableLinkStyle } from '@/lib/admin/styles';

export interface PaginationProps {
  basePath: string;
  page: number;
  pageSize: number;
  total: number;
  search?: string;
}

export function Pagination(props: PaginationProps): React.ReactElement | null {
  const totalPages = Math.max(1, Math.ceil(props.total / props.pageSize));
  if (totalPages <= 1) return null;
  const prevPage = props.page > 1 ? props.page - 1 : null;
  const nextPage = props.page < totalPages ? props.page + 1 : null;

  function buildHref(targetPage: number): string {
    const params = new URLSearchParams();
    if (props.search) params.set('q', props.search);
    if (props.pageSize !== 25) params.set('pageSize', String(props.pageSize));
    params.set('page', String(targetPage));
    return `${props.basePath}?${params.toString()}`;
  }

  return (
    <nav
      aria-label="Pagination"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '1rem',
        marginTop: '1rem',
        fontSize: '0.9rem',
      }}
    >
      <div style={{ color: '#525252' }}>
        Page <strong>{props.page}</strong> of <strong>{totalPages}</strong>
        {' · '}
        {props.total} rows
      </div>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        {prevPage ? (
          <Link href={buildHref(prevPage)} style={tableLinkStyle}>
            ← Previous
          </Link>
        ) : (
          <span style={{ color: '#a3a3a3' }}>← Previous</span>
        )}
        {nextPage ? (
          <Link href={buildHref(nextPage)} style={tableLinkStyle}>
            Next →
          </Link>
        ) : (
          <span style={{ color: '#a3a3a3' }}>Next →</span>
        )}
      </div>
    </nav>
  );
}
