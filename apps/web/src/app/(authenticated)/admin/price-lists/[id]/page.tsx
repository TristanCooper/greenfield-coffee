// apps/web/src/app/(authenticated)/admin/price-lists/[id]/page.tsx
//
// Card 0.16 — Price list detail / edit page.

import { notFound } from 'next/navigation';
import { requireAdminContext } from '@/lib/admin/server';
import { can } from '@/lib/rbac';
import {
  getPriceList,
  updatePriceList,
  deletePriceList,
} from '../actions';
import { PriceListForm } from '../PriceListForm';
import { cardStyle } from '@/lib/admin/styles';
import { DeletePriceListButton } from './DeletePriceListButton';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function PriceListDetailPage({
  params,
}: PageProps): Promise<React.ReactElement> {
  const ctx = await requireAdminContext();
  const { id } = await params;
  const detail = await getPriceList(ctx.orgId, id);
  if (!detail) notFound();

  const canEdit = can(ctx.role, 'update', 'price_list');
  const canDelete = can(ctx.role, 'delete', 'price_list');

  return (
    <div style={{ maxWidth: '60rem' }}>
      <h2 style={{ margin: '0 0 1rem', fontSize: '1.25rem', fontWeight: 600 }}>
        Edit price list
      </h2>
      <PriceListForm
        action={updatePriceList}
        submitLabel="Save changes"
        cancelHref="/admin/price-lists"
        disabled={!canEdit}
        defaults={{
          id: detail.priceList.id,
          code: detail.priceList.code,
          name: detail.priceList.name,
          kind: detail.priceList.kind,
          vatMode: detail.priceList.vat_mode,
          vatRatePct: detail.priceList.vat_rate_pct,
          currencyCode: detail.priceList.currency_code,
          effectiveFrom: detail.priceList.effective_from,
          effectiveTo: detail.priceList.effective_to,
          entries: detail.entries.map((e) => ({
            skuId: e.sku_id,
            skuCode: e.sku_code,
            skuName: e.sku_name,
            priceMinorUnits: e.price_minor_units,
            currencyCode: e.currency_code,
            vatRateBps: e.vat_rate_bps,
            minQuantity: e.min_quantity ? Number(e.min_quantity) : null,
          })),
          active: detail.priceList.active,
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
            Deleting a price list is permanent. The associated entries are
            deleted with it (ON DELETE CASCADE). Use the Active toggle above
            to hide a list instead.
          </p>
          <DeletePriceListButton
            action={deletePriceList}
            id={detail.priceList.id}
            code={detail.priceList.code}
          />
        </div>
      ) : null}
    </div>
  );
}
