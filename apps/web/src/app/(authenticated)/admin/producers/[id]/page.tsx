// apps/web/src/app/(authenticated)/admin/producers/[id]/page.tsx
//
// Card 0.16 — Producer detail / edit page.

import { notFound } from 'next/navigation';
import { requireAdminContext } from '@/lib/admin/server';
import { can } from '@/lib/rbac';
import { getProducer, updateProducer, deleteProducer } from '../actions';
import { ProducerForm } from '../ProducerForm';
import { cardStyle } from '@/lib/admin/styles';
import { DeleteProducerButton } from './DeleteProducerButton';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ProducerDetailPage({
  params,
}: PageProps): Promise<React.ReactElement> {
  const ctx = await requireAdminContext();
  const { id } = await params;
  const detail = await getProducer(ctx.orgId, id);
  if (!detail) notFound();

  const canEdit = can(ctx.role, 'update', 'producer');
  const canDelete = can(ctx.role, 'delete', 'producer');

  return (
    <div style={{ maxWidth: '50rem' }}>
      <h2 style={{ margin: '0 0 1rem', fontSize: '1.25rem', fontWeight: 600 }}>
        Edit producer
      </h2>
      <ProducerForm
        action={updateProducer}
        submitLabel="Save changes"
        cancelHref="/admin/producers"
        disabled={!canEdit}
        defaults={{
          id: detail.producer.id,
          name: detail.producer.name,
          countryCode: detail.producer.country_code,
          region: detail.producer.region,
          areaHectares: detail.areaHectares,
          verificationSource: detail.producer.verification_source,
          riskRating: detail.producer.risk_rating,
          geolocation: detail.geolocation,
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
            Deleting a producer is permanent and will fail if the producer is
            referenced by a green_lot. Use the verification/risk fields above
            to flag a producer as high-risk instead.
          </p>
          <DeleteProducerButton
            action={deleteProducer}
            id={detail.producer.id}
            name={detail.producer.name}
          />
        </div>
      ) : null}
    </div>
  );
}
