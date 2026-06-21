'use client';

// apps/web/src/app/(authenticated)/admin/producers/[id]/DeleteProducerButton.tsx
//
// Card 0.16 — Delete Producer button (client-side confirmation).

import { buttonDangerStyle } from '@/lib/admin/styles';

export interface DeleteProducerButtonProps {
  action: (formData: FormData) => Promise<unknown>;
  id: string;
  name: string;
}

export function DeleteProducerButton(
  props: DeleteProducerButtonProps,
): React.ReactElement {
  return (
    <form
      action={async (fd: FormData) => {
        await props.action(fd);
      }}
      onSubmit={(e) => {
        if (
          !window.confirm(
            `Delete producer ${props.name}? This cannot be undone.`,
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="id" value={props.id} />
      <button type="submit" style={buttonDangerStyle}>
        Delete producer
      </button>
    </form>
  );
}
