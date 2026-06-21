'use client';

// apps/web/src/app/(authenticated)/admin/customers/[id]/DeleteCustomerButton.tsx
//
// Card 0.16 — Delete Customer form (client-side confirmation).
// Mirrors apps/web/src/app/(authenticated)/admin/skus/[id]/DeleteSkuButton.tsx.

import { buttonDangerStyle } from '@/lib/admin/styles';

export interface DeleteCustomerButtonProps {
  action: (formData: FormData) => Promise<unknown>;
  id: string;
  code: string;
}

export function DeleteCustomerButton(
  props: DeleteCustomerButtonProps,
): React.ReactElement {
  return (
    <form
      action={async (fd: FormData) => {
        await props.action(fd);
      }}
      onSubmit={(e) => {
        if (
          !window.confirm(
            `Delete customer ${props.code}? This cannot be undone.`,
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="id" value={props.id} />
      <button type="submit" style={buttonDangerStyle}>
        Delete customer
      </button>
    </form>
  );
}
