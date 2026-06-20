// apps/web/src/app/(authenticated)/admin/suppliers/new/page.tsx
//
// Card 0.16 — create-Supplier form page.

import { redirect } from 'next/navigation';
import { requireAdminContext } from '@/lib/admin/server';
import { can } from '@/lib/rbac';
import { SupplierForm } from '../SupplierForm';
import { createSupplier } from '../actions';
import { defaultRiskAssessment } from '../risk-assessment';

export const dynamic = 'force-dynamic';

export default async function NewSupplierPage(): Promise<React.ReactElement> {
  const ctx = await requireAdminContext();
  if (!can(ctx.role, 'create', 'supplier')) {
    redirect('/admin/suppliers?error=forbidden');
  }

  return (
    <div style={{ maxWidth: '50rem' }}>
      <h2 style={{ margin: '0 0 1rem', fontSize: '1.25rem', fontWeight: 600 }}>
        New supplier
      </h2>
      <SupplierForm
        action={createSupplier}
        submitLabel="Create supplier"
        cancelHref="/admin/suppliers"
        defaults={{ risk: defaultRiskAssessment() }}
      />
    </div>
  );
}
