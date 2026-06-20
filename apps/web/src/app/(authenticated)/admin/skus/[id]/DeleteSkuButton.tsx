// apps/web/src/app/(authenticated)/admin/skus/[id]/DeleteSkuButton.tsx
//
// Card 0.16 — Delete SKU form (client-side confirmation).
//
// Server Components can't add onSubmit handlers (no `window`).
// This thin Client Component renders the form + the confirmation
// dialog. The action is the server action deleteSku from actions.ts.

'use client';

import { buttonDangerStyle } from '@/lib/admin/styles';

export interface DeleteSkuButtonProps {
  action: (formData: FormData) => Promise<unknown>;
  id: string;
  code: string;
}

export function DeleteSkuButton(props: DeleteSkuButtonProps): React.ReactElement {
  return (
    <form
      action={async (fd: FormData) => {
        await props.action(fd);
      }}
      onSubmit={(e) => {
        if (!window.confirm(`Delete SKU ${props.code}? This cannot be undone.`)) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="id" value={props.id} />
      <button type="submit" style={buttonDangerStyle}>
        Delete SKU
      </button>
    </form>
  );
}
