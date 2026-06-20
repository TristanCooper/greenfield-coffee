// apps/web/src/app/(authenticated)/admin/customers/new/page.tsx
//
// Card 0.16 — create-Customer form page. Thin Server Component
// gating on the role and rendering CustomerForm.

import { redirect } from 'next/navigation';
import { requireAdminContext } from '@/lib/admin/server';
import { can } from '@/lib/rbac';
import { CustomerForm } from '../CustomerForm';
import { createCustomer } from '../actions';

export const dynamic = 'force-dynamic';

export default async function NewCustomerPage(): Promise<React.ReactElement> {
  const ctx = await requireAdminContext();
  if (!can(ctx.role, 'create', 'customer')) {
    redirect('/admin/customers?error=forbidden');
  }

  return (
    <div style={{ maxWidth: '40rem' }}>
      <h2 style={{ margin: '0 0 1rem', fontSize: '1.25rem', fontWeight: 600 }}>
        New customer
      </h2>
      <CustomerForm
        action={createCustomer}
        submitLabel="Create customer"
        cancelHref="/admin/customers"
      />
    </div>
  );
}
