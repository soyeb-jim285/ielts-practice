import { createFileRoute, Outlet } from '@tanstack/react-router';
import { LegalLayout } from '@/components/legal/Legal';

export const Route = createFileRoute('/_app/_legal')({
  component: () => (
    <LegalLayout>
      <Outlet />
    </LegalLayout>
  ),
});
