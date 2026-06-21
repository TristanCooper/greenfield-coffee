// apps/web/src/app/(authenticated)/admin/customers/[id]/page.tsx
//
// Card 0.16 — Customer detail / edit page. Mirrors the SKU
// detail page (form + danger-zone Delete button).

import { notFound } from 'next/navigation';
import { requireAdminContext } from '@/lib/admin/server';
import { can } from '@/lib/rbac';
import {
  getCustomer,
  updateCustomer,
  deleteCustomer,
} from '../actions';
import { CustomerForm } from '../CustomerForm';
import { cardStyle } from '@/lib/admin/styles';
import { DeleteCustomerButton } from './DeleteCustomerButton';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function CustomerDetailPage({
  params,
}: PageProps): Promise<React.ReactElement> {
  const ctx = await requireAdminContext();
  const { id } = await params;
  const customer = await getCustomer(ctx.orgId, id);
  if (!customer) notFound();

  const canEdit = can(ctx.role, 'update', 'customer');
  const canDelete = can(ctx.role, 'delete', 'customer');

  return (
    <div style={{ maxWidth: '40rem' }}>
      <h2 style={{ margin: '0 0 1rem', fontSize: '1.25rem', fontWeight: 600 }}>
        Edit customer
      </h2>
      <CustomerForm
        action={updateCustomer}
        submitLabel="Save changes"
        cancelHref="/admin/customers"
        disabled={!canEdit}
        defaults={{
          id: customer.id,
          code: customer.code,
          name: customer.name,
          email: customer.email,
          countryCode: customer.country_code,
          active: customer.active,
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
            Deleting a customer is permanent. Use the Active toggle above to
            hide a customer instead.
          </p>
          <DeleteCustomerButton
            action={deleteCustomer}
            id={customer.id}
            code={customer.code}
          />
        </div>
      ) : null}
    </div>
  );
}
