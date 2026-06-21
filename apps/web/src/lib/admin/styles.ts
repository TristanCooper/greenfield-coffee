// apps/web/src/lib/admin/styles.ts
//
// Card 0.16 — shared inline-style palette for the admin UI.
//
// We use plain `React.CSSProperties` objects rather than CSS
// modules or Tailwind. Reasons:
//
//   1. Consistency with the rest of apps/web/src/app/(authenticated)/
//      — see receiving/green/new/GreenReceivingWizard.tsx (card 0.17),
//      which uses the same pattern. Adopting a different styling system
//      for the admin section would create two ways of doing the same
//      thing in the same authed route group.
//
//   2. No CSS build pipeline to maintain. Tailwind/shadcn is not in
//      the project deps yet; adding it for one card is scope creep.
//      A future card can add Tailwind globally and refactor these
//      styles to use utility classes; the props exposed by the form
//      components stay the same.
//
//   3. Server Component compatibility. Inline styles serialize fine
//      across the server/client boundary; CSS modules require extra
//      wiring for RSC.
//
// PALETTE
//
//   The colours match the receiving wizard's palette so the admin
//   pages feel native to the rest of the app. Adjustments land in
//   one file when the design system grows up.

import type { CSSProperties } from 'react';

export const COLOURS = {
  bg: '#fafafa',
  bgCard: '#ffffff',
  bgHover: '#f4f4f4',
  border: '#d4d4d4',
  borderStrong: '#a3a3a3',
  text: '#1f1f1f',
  textMuted: '#525252',
  textSubtle: '#737373',
  primary: '#1d4ed8',
  primaryHover: '#1e40af',
  primaryBg: '#dbeafe',
  danger: '#b91c1c',
  dangerBg: '#fee2e2',
  dangerBorder: '#fca5a5',
  success: '#15803d',
  successBg: '#dcfce7',
  warning: '#a16207',
  warningBg: '#fef3c7',
  infoBg: '#eef2ff',
  infoBorder: '#c7d2fe',
  infoText: '#3730a3',
} as const;

export const pageStyle: CSSProperties = {
  fontFamily: 'system-ui, -apple-system, sans-serif',
  background: COLOURS.bg,
  color: COLOURS.text,
  minHeight: '100vh',
  padding: '1.5rem',
};

export const pageInnerStyle: CSSProperties = {
  maxWidth: '80rem',
  margin: '0 auto',
};

export const headerStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'flex-end',
  justifyContent: 'space-between',
  gap: '1rem',
  marginBottom: '1.5rem',
};

export const h1Style: CSSProperties = {
  fontSize: '1.75rem',
  fontWeight: 600,
  margin: 0,
  marginBottom: '0.25rem',
};

export const subheadStyle: CSSProperties = {
  fontSize: '0.95rem',
  color: COLOURS.textMuted,
  margin: 0,
};

export const navStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.5rem',
  marginBottom: '1.5rem',
  paddingBottom: '0.75rem',
  borderBottom: `1px solid ${COLOURS.border}`,
};

export const navLinkStyle: CSSProperties = {
  padding: '0.4rem 0.75rem',
  borderRadius: 4,
  textDecoration: 'none',
  color: COLOURS.text,
  fontSize: '0.9rem',
  fontWeight: 500,
};

export const navLinkActiveStyle: CSSProperties = {
  ...navLinkStyle,
  background: COLOURS.primaryBg,
  color: COLOURS.infoText,
};

export const cardStyle: CSSProperties = {
  background: COLOURS.bgCard,
  border: `1px solid ${COLOURS.border}`,
  borderRadius: 6,
  padding: '1.25rem',
  marginBottom: '1rem',
};

export const errorStyle: CSSProperties = {
  padding: '0.75rem 1rem',
  background: COLOURS.dangerBg,
  border: `1px solid ${COLOURS.dangerBorder}`,
  borderRadius: 4,
  color: COLOURS.danger,
  marginBottom: '1rem',
  fontSize: '0.9rem',
};

export const successStyle: CSSProperties = {
  padding: '0.75rem 1rem',
  background: COLOURS.successBg,
  border: `1px solid #86efac`,
  borderRadius: 4,
  color: COLOURS.success,
  marginBottom: '1rem',
  fontSize: '0.9rem',
};

export const infoBannerStyle: CSSProperties = {
  padding: '0.75rem 1rem',
  background: COLOURS.infoBg,
  border: `1px solid ${COLOURS.infoBorder}`,
  borderRadius: 4,
  color: COLOURS.infoText,
  marginBottom: '1rem',
  fontSize: '0.9rem',
};

export const fieldStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.25rem',
  marginBottom: '1rem',
};

export const labelStyle: CSSProperties = {
  fontSize: '0.85rem',
  fontWeight: 500,
  color: COLOURS.textMuted,
};

export const inputStyle: CSSProperties = {
  padding: '0.5rem 0.6rem',
  border: `1px solid ${COLOURS.border}`,
  borderRadius: 4,
  fontSize: '0.95rem',
  fontFamily: 'inherit',
  background: '#fff',
};

export const inputDisabledStyle: CSSProperties = {
  ...inputStyle,
  background: COLOURS.bg,
  color: COLOURS.textSubtle,
  cursor: 'not-allowed',
};

export const textareaStyle: CSSProperties = {
  ...inputStyle,
  fontFamily: 'inherit',
  resize: 'vertical',
  minHeight: '5rem',
};

export const selectStyle: CSSProperties = {
  ...inputStyle,
};

export const buttonPrimaryStyle: CSSProperties = {
  padding: '0.55rem 1rem',
  background: COLOURS.primary,
  color: '#fff',
  border: 'none',
  borderRadius: 4,
  fontSize: '0.95rem',
  fontWeight: 500,
  cursor: 'pointer',
};

export const buttonSecondaryStyle: CSSProperties = {
  padding: '0.55rem 1rem',
  background: '#fff',
  color: COLOURS.text,
  border: `1px solid ${COLOURS.border}`,
  borderRadius: 4,
  fontSize: '0.95rem',
  fontWeight: 500,
  cursor: 'pointer',
};

export const buttonDangerStyle: CSSProperties = {
  ...buttonSecondaryStyle,
  color: COLOURS.danger,
  borderColor: COLOURS.dangerBorder,
};

export const buttonRowStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.75rem',
  marginTop: '1rem',
};

// Table styles (the v0 DataTable primitive).
export const tableWrapStyle: CSSProperties = {
  overflowX: 'auto',
  border: `1px solid ${COLOURS.border}`,
  borderRadius: 6,
  background: COLOURS.bgCard,
};

export const tableStyle: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '0.9rem',
};

export const thStyle: CSSProperties = {
  textAlign: 'left',
  padding: '0.6rem 0.75rem',
  background: COLOURS.bgHover,
  borderBottom: `1px solid ${COLOURS.border}`,
  fontWeight: 600,
  fontSize: '0.8rem',
  color: COLOURS.textMuted,
  textTransform: 'uppercase',
  letterSpacing: '0.025em',
};

export const tdStyle: CSSProperties = {
  padding: '0.6rem 0.75rem',
  borderBottom: `1px solid ${COLOURS.border}`,
  verticalAlign: 'top',
};

export const tableLinkStyle: CSSProperties = {
  color: COLOURS.primary,
  textDecoration: 'none',
};

export const tableLinkHoverStyle: CSSProperties = {
  ...tableLinkStyle,
  textDecoration: 'underline',
};

// Empty state (no rows yet).
export const emptyStateStyle: CSSProperties = {
  textAlign: 'center',
  padding: '3rem 1.5rem',
  background: COLOURS.bgCard,
  border: `2px dashed ${COLOURS.border}`,
  borderRadius: 6,
};

export const emptyStateTitleStyle: CSSProperties = {
  fontSize: '1.1rem',
  fontWeight: 600,
  margin: 0,
  marginBottom: '0.5rem',
};

export const emptyStateTextStyle: CSSProperties = {
  fontSize: '0.9rem',
  color: COLOURS.textMuted,
  margin: 0,
  marginBottom: '1rem',
};

// Skeleton placeholder for loading states.
export const skeletonRowStyle: CSSProperties = {
  height: '2.5rem',
  background: COLOURS.bgHover,
  borderRadius: 4,
  marginBottom: '0.5rem',
  animation: 'pulse 1.5s ease-in-out infinite',
};

// Mobile: card-list table fallback. The list view uses CSS media
// queries via inline styles by setting a class on the wrapper;
// the wrapper component (apps/web/src/lib/admin/MobileTable.tsx)
// handles the breakpoint logic.
export const mobileCardStyle: CSSProperties = {
  background: COLOURS.bgCard,
  border: `1px solid ${COLOURS.border}`,
  borderRadius: 6,
  padding: '1rem',
  marginBottom: '0.75rem',
};
