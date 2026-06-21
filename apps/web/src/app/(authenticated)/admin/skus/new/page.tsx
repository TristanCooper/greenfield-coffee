// apps/web/src/app/(authenticated)/admin/skus/new/page.tsx
//
// Card 0.16 — create-SKU form page.
//
// The page is a thin Server Component that gates on the role (only
// owner can create SKUs) and renders the SkuForm client component.

import { redirect } from 'next/navigation';
import { requireAdminContext } from '@/lib/admin/server';
import { can } from '@/lib/rbac';
import { SkuForm } from '../SkuForm';
import { createSku } from '../actions';

export const dynamic = 'force-dynamic';

export default async function NewSkuPage(): Promise<React.ReactElement> {
  const ctx = await requireAdminContext();
  if (!can(ctx.role, 'create', 'sku')) {
    redirect('/admin/skus?error=forbidden');
  }

  return (
    <div style={{ maxWidth: '40rem' }}>
      <h2 style={{ margin: '0 0 1rem', fontSize: '1.25rem', fontWeight: 600 }}>
        New SKU
      </h2>
      <SkuForm
        action={createSku}
        submitLabel="Create SKU"
        cancelHref="/admin/skus"
      />
    </div>
  );
}
