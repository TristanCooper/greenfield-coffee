'use client';

// apps/web/src/app/(authenticated)/admin/packagings/[id]/DeletePackagingButton.tsx
//
// Card 0.16 — Delete Packaging button (client-side confirmation).

import { buttonDangerStyle } from '@/lib/admin/styles';

export interface DeletePackagingButtonProps {
  action: (formData: FormData) => Promise<unknown>;
  id: string;
  code: string;
}

export function DeletePackagingButton(
  props: DeletePackagingButtonProps,
): React.ReactElement {
  return (
    <form
      action={async (fd: FormData) => {
        await props.action(fd);
      }}
      onSubmit={(e) => {
        if (
          !window.confirm(
            `Delete packaging ${props.code}? This cannot be undone.`,
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="id" value={props.id} />
      <button type="submit" style={buttonDangerStyle}>
        Delete packaging
      </button>
    </form>
  );
}
