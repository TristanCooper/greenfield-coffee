// apps/web/src/app/(authenticated)/admin/recipes/new/page.tsx
//
// Card 0.16 — create-Recipe form page.

import { redirect } from 'next/navigation';
import { requireAdminContext } from '@/lib/admin/server';
import { can } from '@/lib/rbac';
import { RecipeForm } from '../RecipeForm';
import { createRecipe } from '../actions';

export const dynamic = 'force-dynamic';

export default async function NewRecipePage(): Promise<React.ReactElement> {
  const ctx = await requireAdminContext();
  if (!can(ctx.role, 'create', 'recipe')) {
    redirect('/admin/recipes?error=forbidden');
  }

  return (
    <div style={{ maxWidth: '50rem' }}>
      <h2 style={{ margin: '0 0 1rem', fontSize: '1.25rem', fontWeight: 600 }}>
        New recipe
      </h2>
      <RecipeForm
        action={createRecipe}
        submitLabel="Create recipe"
        cancelHref="/admin/recipes"
      />
    </div>
  );
}
