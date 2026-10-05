import { createFileRoute, notFound, Outlet } from '@tanstack/react-router';
import { AdminNav } from '@/components/admin/AdminNav';
import { Alert, PageContainer } from '@/components/ui';
import { useAdmin } from '@/lib/admin';
import { meQuery } from '@/lib/query';

/** Owner-only area (docs/admin/DESIGN.md): invisible, so a non-owner gets the plain not-found page. Tab nav on top, low-balance warnings under it, then the page. */
export const Route = createFileRoute('/_app/admin')({
  beforeLoad: async ({ context }) => {
    const me = (await context.queryClient.ensureQueryData(meQuery)) as { isOwner?: boolean } | null;
    if (!me?.isOwner) throw notFound();
  },
  component: AdminLayout,
});

function AdminLayout() {
  const costs = useAdmin<{ warnings: string[] }>('/costs');
  return (
    <>
      <PageContainer className="mb-6 md:mb-8">
        <AdminNav />
        {!!costs.data?.warnings.length && (
          <Alert tone="warn" title="Check your balances" className="mt-4">
            {costs.data.warnings.join(' ')}
          </Alert>
        )}
      </PageContainer>
      <Outlet />
    </>
  );
}
