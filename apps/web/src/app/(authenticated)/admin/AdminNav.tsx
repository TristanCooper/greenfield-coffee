// apps/web/src/app/(authenticated)/admin/AdminNav.tsx
//
// Card 0.16 — navigation tabs for the admin section.
//
// The nav lives in its own client component so it can read the
// current pathname (via usePathname) and highlight the active tab.
// Server-rendering nav links without active state would be simpler
// but the user loses the visual cue for "where am I?" — the nav
// becomes a row of identical-looking links.
//
// ENTITY LIST
//
// The list is hard-coded. The number of entities is small (7) and
// the order matches the plan's data-model grouping:
//   - Operational: SKUs, packagings, recipes
//   - Commercial: customers, price lists
//   - Compliance: suppliers, producers
//
// A future card may move this to a config-driven nav if the entity
// count grows past ~15.

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { navLinkStyle, navLinkActiveStyle, navStyle } from '@/lib/admin/styles';

const ENTITIES = [
  { slug: 'skus', label: 'SKUs', href: '/admin/skus' },
  { slug: 'packagings', label: 'Packagings', href: '/admin/packagings' },
  { slug: 'recipes', label: 'Recipes', href: '/admin/recipes' },
  { slug: 'price-lists', label: 'Price lists', href: '/admin/price-lists' },
  { slug: 'customers', label: 'Customers', href: '/admin/customers' },
  { slug: 'suppliers', label: 'Suppliers', href: '/admin/suppliers' },
  { slug: 'producers', label: 'Producers', href: '/admin/producers' },
] as const;

export function AdminNav({ active }: { active: string | null }): React.ReactElement {
  const pathname = usePathname();

  return (
    <nav style={navStyle} aria-label="Admin sections">
      {ENTITIES.map((entity) => {
        // Active when the current path starts with the entity's href.
        // The `active` prop overrides the path-based check (used when
        // the nav is rendered inside a sub-route that should still
        // highlight its parent — e.g. /admin/skus/new should highlight
        // "SKUs").
        const isActive =
          active === entity.slug ||
          (active === null && pathname?.startsWith(entity.href));
        return (
          <Link
            key={entity.slug}
            href={entity.href}
            style={isActive ? navLinkActiveStyle : navLinkStyle}
          >
            {entity.label}
          </Link>
        );
      })}
    </nav>
  );
}
