// apps/web/src/app/(authenticated)/admin/recipes/[id]/page.tsx
//
// Card 0.16 — Recipe detail / edit page.

import { notFound } from 'next/navigation';
import { requireAdminContext } from '@/lib/admin/server';
import { can } from '@/lib/rbac';
import { getRecipe, updateRecipe, deleteRecipe } from '../actions';
import { RecipeForm } from '../RecipeForm';
import { cardStyle } from '@/lib/admin/styles';
import { DeleteRecipeButton } from './DeleteRecipeButton';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function RecipeDetailPage({
  params,
}: PageProps): Promise<React.ReactElement> {
  const ctx = await requireAdminContext();
  const { id } = await params;
  const detail = await getRecipe(ctx.orgId, id);
  if (!detail) notFound();

  const canEdit = can(ctx.role, 'update', 'recipe');
  const canDelete = can(ctx.role, 'delete', 'recipe');

  return (
    <div style={{ maxWidth: '50rem' }}>
      <h2 style={{ margin: '0 0 1rem', fontSize: '1.25rem', fontWeight: 600 }}>
        Edit recipe
      </h2>
      <RecipeForm
        action={updateRecipe}
        submitLabel="Save changes"
        cancelHref="/admin/recipes"
        disabled={!canEdit}
        defaults={{
          id: detail.recipe.id,
          code: detail.recipe.code,
          name: detail.recipe.name,
          chargeWeightG: detail.recipe.charge_weight_g,
          expectedYieldPct: detail.recipe.expected_yield_pct,
          durationSeconds: detail.recipe.duration_seconds,
          components: detail.components.map((c) => ({
            greenLotId: c.green_lot_id,
            greenLotCode: c.green_lot_code,
            percentBps: c.percent_bps,
            notes: c.notes,
          })),
          active: detail.recipe.active,
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
            Deleting a recipe is permanent and will fail if the recipe is
            referenced by a roast_batch. Use the Active toggle above to hide
            it instead.
          </p>
          <DeleteRecipeButton
            action={deleteRecipe}
            id={detail.recipe.id}
            code={detail.recipe.code}
          />
        </div>
      ) : null}
    </div>
  );
}
