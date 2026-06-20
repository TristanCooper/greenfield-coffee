// apps/web/src/app/(authenticated)/admin/_components/AdminToolbar.tsx
//
// Card 0.16 — shared list-view toolbar.
//
// The toolbar is the row at the top of every list view with:
//   - Page title + count
//   - Search input (GET form — preserves URL bookmarks)
//   - "New" button (only for roles with create permission)
//
// The toolbar is a pure presentation component; the page-level
// Server Component passes in the title, count, and canCreate flag.

import Link from 'next/link';
import { buttonPrimaryStyle } from '@/lib/admin/styles';
import { can } from '@/lib/rbac';
import type { AdminEntity } from '@/lib/rbac';
import type { MembershipRole } from '@greenfield/db';

export interface AdminToolbarProps {
  title: string;
  newHref: string;
  entity: AdminEntity;
  role: MembershipRole;
  total: number;
  searchValue?: string;
  searchPlaceholder?: string;
  /** Hidden search action — defaults to the current path with ?q=. */
  action?: string;
}

export function AdminToolbar(props: AdminToolbarProps): React.ReactElement {
  const canCreate = can(props.role, 'create', props.entity);
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        gap: '1rem',
        marginBottom: '1.25rem',
      }}
    >
      <div>
        <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600 }}>
          {props.title}
        </h2>
        <p style={{ margin: '0.25rem 0 0', color: '#525252', fontSize: '0.9rem' }}>
          {props.total} {props.total === 1 ? 'row' : 'rows'}
        </p>
      </div>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <form method="get" action={props.action ?? ''} style={{ display: 'flex', gap: '0.5rem' }}>
          <input
            type="search"
            name="q"
            placeholder={props.searchPlaceholder ?? 'Search…'}
            defaultValue={props.searchValue ?? ''}
            style={{
              padding: '0.5rem 0.6rem',
              border: '1px solid #d4d4d4',
              borderRadius: 4,
              fontSize: '0.9rem',
              minWidth: '12rem',
            }}
          />
          <button
            type="submit"
            style={{
              padding: '0.5rem 0.75rem',
              border: '1px solid #d4d4d4',
              borderRadius: 4,
              background: '#fff',
              fontSize: '0.9rem',
              cursor: 'pointer',
            }}
          >
            Search
          </button>
        </form>
        {canCreate ? (
          <Link href={props.newHref} style={buttonPrimaryStyle}>
            New
          </Link>
        ) : null}
      </div>
    </div>
  );
}
