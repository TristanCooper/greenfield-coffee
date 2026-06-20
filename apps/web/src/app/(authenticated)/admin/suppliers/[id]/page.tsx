// apps/web/src/app/(authenticated)/admin/suppliers/[id]/page.tsx
//
// Card 0.16 — Supplier detail / edit page.

import { notFound } from 'next/navigation';
import { requireAdminContext } from '@/lib/admin/server';
import { can } from '@/lib/rbac';
import { getSupplier, updateSupplier, deleteSupplier } from '../actions';
import { SupplierForm } from '../SupplierForm';
import { cardStyle } from '@/lib/admin/styles';
import { readRiskAssessment } from '../risk-assessment';
import { DeleteSupplierButton } from './DeleteSupplierButton';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function SupplierDetailPage({
  params,
}: PageProps): Promise<React.ReactElement> {
  const ctx = await requireAdminContext();
  const { id } = await params;
  const supplier = await getSupplier(ctx.orgId, id);
  if (!supplier) notFound();

  const canEdit = can(ctx.role, 'update', 'supplier');
  const canDelete = can(ctx.role, 'delete', 'supplier');

  const contact =
    supplier.contact && typeof supplier.contact === 'object'
      ? (supplier.contact as {
          email?: string | null;
          phone?: string | null;
          address?: string | null;
        })
      : {};
  const risk = readRiskAssessment(supplier.risk_assessment);

  return (
    <div style={{ maxWidth: '50rem' }}>
      <h2 style={{ margin: '0 0 1rem', fontSize: '1.25rem', fontWeight: 600 }}>
        Edit supplier
      </h2>
      <SupplierForm
        action={updateSupplier}
        submitLabel="Save changes"
        cancelHref="/admin/suppliers"
        disabled={!canEdit}
        defaults={{
          id: supplier.id,
          name: supplier.name,
          countryCode: supplier.country_code,
          eori: supplier.eori,
          ddsReference: supplier.dds_reference,
          contact,
          risk,
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
            Deleting a supplier is permanent and will fail if the supplier is
            referenced by a green_lot. Use the risk fields above to record a
            high-risk rating instead.
          </p>
          <DeleteSupplierButton
            action={deleteSupplier}
            id={supplier.id}
            name={supplier.name}
          />
        </div>
      ) : null}
    </div>
  );
}
