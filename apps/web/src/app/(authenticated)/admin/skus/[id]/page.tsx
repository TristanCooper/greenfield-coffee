// apps/web/src/app/(authenticated)/admin/skus/[id]/page.tsx
//
// Card 0.16 — SKU detail / edit page.
//
// Combined view: shows the SKU's fields in an editable form, with
// a Delete button (when the role allows) that uses a confirmation
// prompt. The detail page IS the edit page — v0 doesn't need a
// separate read-only view because every role that can read can
// also edit (skus have only owner-writers; everyone else sees the
// form disabled — though for v0 owner is the only writer so the
// read-only case is just "the form is disabled").
//
// DELETE BUTTON
//
//   The Delete button is a separate <form action={deleteSku}> that
//   POSTs the id. We use `onSubmit` (client-side) to confirm via
//   window.confirm() before submitting — server-side confirmation
//   would require another round trip. The window.confirm is a
//   serviceable v0; a richer modal lands later.

import { notFound } from 'next/navigation';
import { requireAdminContext } from '@/lib/admin/server';
import { can } from '@/lib/rbac';
import { getSku, deleteSku } from '../actions';
import { SkuForm } from '../SkuForm';
import { updateSku } from '../actions';
import { cardStyle } from '@/lib/admin/styles';
import { DeleteSkuButton } from './DeleteSkuButton';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function SkuDetailPage({ params }: PageProps): Promise<React.ReactElement> {
  const ctx = await requireAdminContext();
  const { id } = await params;
  const sku = await getSku(ctx.orgId, id);
  if (!sku) {
    notFound();
  }
  const canEdit = can(ctx.role, 'update', 'sku');
  const canDelete = can(ctx.role, 'delete', 'sku');

  return (
    <div style={{ maxWidth: '40rem' }}>
      <h2 style={{ margin: '0 0 1rem', fontSize: '1.25rem', fontWeight: 600 }}>
        Edit SKU
      </h2>
      <SkuForm
        action={updateSku}
        submitLabel="Save changes"
        cancelHref="/admin/skus"
        disabled={!canEdit}
        defaults={{
          id: sku.id,
          code: sku.code,
          name: sku.name,
          unitWeightG: sku.unit_weight_g,
          wholesaleOnly: sku.wholesale_only,
          tags: sku.tags,
          active: sku.active,
        }}
      />
      {canDelete ? (
        <div style={{ ...cardStyle, marginTop: '2rem', borderColor: '#fca5a5' }}>
          <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem', color: '#b91c1c' }}>
            Danger zone
          </h3>
          <p style={{ margin: '0 0 0.75rem', fontSize: '0.9rem', color: '#525252' }}>
            Deleting a SKU is permanent and will fail if the SKU is referenced by
            a packaged_lot or a price_list_entry. Use the Active toggle above to
            hide a SKU instead.
          </p>
          <DeleteSkuButton action={deleteSku} id={sku.id} code={sku.code} />
        </div>
      ) : null}
    </div>
  );
}
