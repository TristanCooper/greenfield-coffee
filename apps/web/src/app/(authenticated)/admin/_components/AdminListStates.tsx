// apps/web/src/app/(authenticated)/admin/_components/AdminListStates.tsx
//
// Card 0.16 — empty / error / loading states for admin list views.
//
// The card body requires:
//   - "Empty state: when no rows exist, the list view shows a 'Get
//      started' empty state with a primary CTA to create"
//   - "Loading and error states on every list + form (skeleton / retry
//      button)"
//
// These are minimal inline components. The list view renders one of
// {empty, error, loading, rows} depending on the page render. Each
// state owns its own presentation — there is no "show this if X"
// branching inside a single component.

import Link from 'next/link';
import {
  emptyStateStyle,
  emptyStateTitleStyle,
  emptyStateTextStyle,
  errorStyle,
  buttonPrimaryStyle,
} from '@/lib/admin/styles';
import { buttonSecondaryStyle } from '@/lib/admin/styles';
import { can } from '@/lib/rbac';
import type { AdminEntity } from '@/lib/rbac';
import type { MembershipRole } from '@greenfield/db';

export interface EmptyStateProps {
  title: string;
  description: string;
  ctaHref: string;
  ctaLabel: string;
  entity: AdminEntity;
  role: MembershipRole;
}

export function EmptyState(props: EmptyStateProps): React.ReactElement {
  const canCreate = can(props.role, 'create', props.entity);
  return (
    <div style={emptyStateStyle}>
      <p style={emptyStateTitleStyle}>{props.title}</p>
      <p style={emptyStateTextStyle}>{props.description}</p>
      {canCreate ? (
        <Link href={props.ctaHref} style={buttonPrimaryStyle}>
          {props.ctaLabel}
        </Link>
      ) : (
        <p style={{ ...emptyStateTextStyle, fontStyle: 'italic' }}>
          Your role ({props.role}) does not have create permission for this entity.
        </p>
      )}
    </div>
  );
}

export function ListError(props: { message: string; retryHref: string }): React.ReactElement {
  return (
    <div style={errorStyle} role="alert">
      <p style={{ margin: '0 0 0.5rem', fontWeight: 600 }}>
        Could not load the list.
      </p>
      <p style={{ margin: '0 0 0.75rem' }}>{props.message}</p>
      <Link href={props.retryHref} style={buttonSecondaryStyle}>
        Retry
      </Link>
    </div>
  );
}

/** Skeleton placeholder for the loading state (rare in v0 — pages are SSR). */
export function ListSkeleton(): React.ReactElement {
  return (
    <div aria-busy="true" aria-label="Loading">
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          style={{
            height: '2.5rem',
            background: '#f4f4f4',
            borderRadius: 4,
            marginBottom: '0.5rem',
          }}
        />
      ))}
    </div>
  );
}
