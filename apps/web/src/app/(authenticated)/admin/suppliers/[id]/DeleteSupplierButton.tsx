'use client';

// apps/web/src/app/(authenticated)/admin/suppliers/[id]/DeleteSupplierButton.tsx
//
// Card 0.16 — Delete Supplier button (client-side confirmation).

import { buttonDangerStyle } from '@/lib/admin/styles';

export interface DeleteSupplierButtonProps {
  action: (formData: FormData) => Promise<unknown>;
  id: string;
  name: string;
}

export function DeleteSupplierButton(
  props: DeleteSupplierButtonProps,
): React.ReactElement {
  return (
    <form
      action={async (fd: FormData) => {
        await props.action(fd);
      }}
      onSubmit={(e) => {
        if (
          !window.confirm(
            `Delete supplier ${props.name}? This cannot be undone.`,
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="id" value={props.id} />
      <button type="submit" style={buttonDangerStyle}>
        Delete supplier
      </button>
    </form>
  );
}
