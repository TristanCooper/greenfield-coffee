// apps/web/src/app/(authenticated)/admin/producers/new/page.tsx
//
// Card 0.16 — create-Producer form page.

import { redirect } from 'next/navigation';
import { requireAdminContext } from '@/lib/admin/server';
import { can } from '@/lib/rbac';
import { ProducerForm } from '../ProducerForm';
import { createProducer } from '../actions';

export const dynamic = 'force-dynamic';

export default async function NewProducerPage(): Promise<React.ReactElement> {
  const ctx = await requireAdminContext();
  if (!can(ctx.role, 'create', 'producer')) {
    redirect('/admin/producers?error=forbidden');
  }

  return (
    <div style={{ maxWidth: '50rem' }}>
      <h2 style={{ margin: '0 0 1rem', fontSize: '1.25rem', fontWeight: 600 }}>
        New producer
      </h2>
      <ProducerForm
        action={createProducer}
        submitLabel="Create producer"
        cancelHref="/admin/producers"
      />
    </div>
  );
}
