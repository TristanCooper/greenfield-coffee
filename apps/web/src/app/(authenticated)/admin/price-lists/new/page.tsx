// apps/web/src/app/(authenticated)/admin/price-lists/new/page.tsx
//
// Card 0.16 — create-PriceList form page.

import { redirect } from 'next/navigation';
import { requireAdminContext } from '@/lib/admin/server';
import { can } from '@/lib/rbac';
import { PriceListForm } from '../PriceListForm';
import { createPriceList } from '../actions';

export const dynamic = 'force-dynamic';

export default async function NewPriceListPage(): Promise<React.ReactElement> {
  const ctx = await requireAdminContext();
  if (!can(ctx.role, 'create', 'price_list')) {
    redirect('/admin/price-lists?error=forbidden');
  }

  return (
    <div style={{ maxWidth: '60rem' }}>
      <h2 style={{ margin: '0 0 1rem', fontSize: '1.25rem', fontWeight: 600 }}>
        New price list
      </h2>
      <PriceListForm
        action={createPriceList}
        submitLabel="Create price list"
        cancelHref="/admin/price-lists"
      />
    </div>
  );
}
