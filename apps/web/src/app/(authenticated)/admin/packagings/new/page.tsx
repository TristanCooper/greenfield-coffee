// apps/web/src/app/(authenticated)/admin/packagings/new/page.tsx
//
// Card 0.16 — create-Packaging form page.

import { redirect } from 'next/navigation';
import { requireAdminContext } from '@/lib/admin/server';
import { can } from '@/lib/rbac';
import { PackagingForm } from '../PackagingForm';
import { createPackaging } from '../actions';

export const dynamic = 'force-dynamic';

export default async function NewPackagingPage(): Promise<React.ReactElement> {
  const ctx = await requireAdminContext();
  if (!can(ctx.role, 'create', 'packaging')) {
    redirect('/admin/packagings?error=forbidden');
  }

  return (
    <div style={{ maxWidth: '40rem' }}>
      <h2 style={{ margin: '0 0 1rem', fontSize: '1.25rem', fontWeight: 600 }}>
        New packaging
      </h2>
      <PackagingForm
        action={createPackaging}
        submitLabel="Create packaging"
        cancelHref="/admin/packagings"
      />
    </div>
  );
}
