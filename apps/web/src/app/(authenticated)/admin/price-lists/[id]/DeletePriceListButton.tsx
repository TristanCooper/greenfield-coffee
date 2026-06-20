'use client';

// apps/web/src/app/(authenticated)/admin/price-lists/[id]/DeletePriceListButton.tsx
//
// Card 0.16 — Delete Price List button (client-side confirmation).

import { buttonDangerStyle } from '@/lib/admin/styles';

export interface DeletePriceListButtonProps {
  action: (formData: FormData) => Promise<unknown>;
  id: string;
  code: string;
}

export function DeletePriceListButton(
  props: DeletePriceListButtonProps,
): React.ReactElement {
  return (
    <form
      action={async (fd: FormData) => {
        await props.action(fd);
      }}
      onSubmit={(e) => {
        if (
          !window.confirm(
            `Delete price list ${props.code}? This cannot be undone.`,
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="id" value={props.id} />
      <button type="submit" style={buttonDangerStyle}>
        Delete price list
      </button>
    </form>
  );
}
