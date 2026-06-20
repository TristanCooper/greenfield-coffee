// apps/web/src/app/(authenticated)/admin/page.tsx
//
// Card 0.16 — admin landing page.
//
// The landing page is a brief overview pointing at the available
// admin sections. Each section is one click away via the nav.
//
// The page itself does no DB work — the data lives in the entity
// list views. The role is shown on the page so a user with an
// unexpected role can sanity-check what permissions they're using.

import Link from 'next/link';
import { requireAdminContext } from '@/lib/admin/server';
import { cardStyle, tableLinkStyle } from '@/lib/admin/styles';

export const dynamic = 'force-dynamic';

const ENTITIES = [
  { slug: 'skus', label: 'SKUs', description: 'Saleable products: bags, cases, gift cards. Codes, weights, tags.' },
  { slug: 'packagings', label: 'Packagings', description: 'Bags, cases, tins. Material, tare, capacity, unit cost.' },
  { slug: 'recipes', label: 'Recipes', description: 'Roast profiles. Charge weight, yield, duration, blend components.' },
  { slug: 'price-lists', label: 'Price lists', description: 'Per-SKU pricing. VAT modes (inclusive/exclusive), per-SKU rate overrides.' },
  { slug: 'customers', label: 'Customers', description: 'Buyers. Name, contact, address, tax ID.' },
  { slug: 'suppliers', label: 'Suppliers', description: 'Upstream sellers. Country, EORI, DDS reference, risk assessment.' },
  { slug: 'producers', label: 'Producers', description: 'Farms and cooperatives. Region, area, geolocation, verification source.' },
];

export default async function AdminIndexPage(): Promise<React.ReactElement> {
  const ctx = await requireAdminContext();

  return (
    <div>
      <p style={{ marginBottom: '1.5rem', color: '#525252' }}>
        Reference data your roastery operates with. Each section is form-driven CRUD; the
        card body’s RBAC matrix determines which roles can write which entity.
      </p>
      <div style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fill, minmax(20rem, 1fr))' }}>
        {ENTITIES.map((e) => (
          <div key={e.slug} style={cardStyle}>
            <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem' }}>
              <Link href={`/admin/${e.slug}`} style={tableLinkStyle}>
                {e.label}
              </Link>
            </h3>
            <p style={{ margin: 0, fontSize: '0.9rem', color: '#525252' }}>
              {e.description}
            </p>
          </div>
        ))}
      </div>
      <p style={{ marginTop: '1.5rem', fontSize: '0.85rem', color: '#737373' }}>
        Signed in as <strong>{ctx.userEmail}</strong> with role <strong>{ctx.role}</strong>.
      </p>
    </div>
  );
}
