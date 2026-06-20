'use client';

// apps/web/src/app/(authenticated)/admin/recipes/[id]/DeleteRecipeButton.tsx
//
// Card 0.16 — Delete Recipe button (client-side confirmation).

import { buttonDangerStyle } from '@/lib/admin/styles';

export interface DeleteRecipeButtonProps {
  action: (formData: FormData) => Promise<unknown>;
  id: string;
  code: string;
}

export function DeleteRecipeButton(
  props: DeleteRecipeButtonProps,
): React.ReactElement {
  return (
    <form
      action={async (fd: FormData) => {
        await props.action(fd);
      }}
      onSubmit={(e) => {
        if (
          !window.confirm(
            `Delete recipe ${props.code}? This cannot be undone.`,
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="id" value={props.id} />
      <button type="submit" style={buttonDangerStyle}>
        Delete recipe
      </button>
    </form>
  );
}
