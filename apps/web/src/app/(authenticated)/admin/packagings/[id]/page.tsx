// apps/web/src/app/(authenticated)/admin/packagings/[id]/page.tsx
//
// Card 0.16 — Packaging detail / edit page.

import { notFound } from 'next/navigation';
import { requireAdminContext } from '@/lib/admin/server';
import { can } from '@/lib/rbac';
import {
  getPackaging,
  updatePackaging,
  deletePackaging,
} from '../actions';
import { PackagingForm } from '../PackagingForm';
import { cardStyle } from '@/lib/admin/styles';
import { DeletePackagingButton } from './DeletePackagingButton';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function PackagingDetailPage({
  params,
}: PageProps): Promise<React.ReactElement> {
  const ctx = await requireAdminContext();
  const { id } = await params;
  const packaging = await getPackaging(ctx.orgId, id);
  if (!packaging) notFound();

  const canEdit = can(ctx.role, 'update', 'packaging');
  const canDelete = can(ctx.role, 'delete', 'packaging');

  return (
    <div style={{ maxWidth: '40rem' }}>
      <h2 style={{ margin: '0 0 1rem', fontSize: '1.25rem', fontWeight: 600 }}>
        Edit packaging
      </h2>
      <PackagingForm
        action={updatePackaging}
        submitLabel="Save changes"
        cancelHref="/admin/packagings"
        disabled={!canEdit}
        defaults={{
          id: packaging.id,
          code: packaging.code,
          name: packaging.name,
          material: packaging.material,
          tareWeightG: packaging.tare_weight_g,
          capacityG: packaging.capacity_g,
          costMinorUnits: packaging.cost_minor_units,
          notes: packaging.notes,
          active: packaging.active,
        }}
      />
      {canDelete ? (
        <div
          style={{ ...cardStyle, marginTop: '2rem', borderColor: '#fca5a5' }}
        >
          <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem', color: '#b91c1c' }}>
            Danger zone
          </h3>
          <p style={{ margin: '0 0 0.75rem', fontSize: '0.9rem', color: '#525252' }}>
            Deleting a packaging is permanent and will fail if the packaging
            is referenced by a packaged_lot. Use the Active toggle above to
            hide it instead.
          </p>
          <DeletePackagingButton
            action={deletePackaging}
            id={packaging.id}
            code={packaging.code}
          />
        </div>
      ) : null}
    </div>
  );
}
