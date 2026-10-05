import { createFileRoute, notFound, Outlet } from '@tanstack/react-router';
import { AdminNav } from '@/components/admin/AdminNav';
import { AttemptDrawer } from '@/components/admin/AttemptDrawer';
import { meQuery } from '@/lib/query';

/** Owner-only area (docs/admin/DESIGN.md): invisible, so a non-owner gets the plain not-found page. The app sidebar lists the admin pages (pills on phones). A `?attempt=<id>` on any admin URL opens that attempt's cost drawer. */
export const Route = createFileRoute('/_app/admin')({
  beforeLoad: async ({ context }) => {
    const me = (await context.queryClient.ensureQueryData(meQuery)) as { isOwner?: boolean } | null;
    if (!me?.isOwner) throw notFound();
  },
  component: AdminLayout,
});

function AdminLayout() {
  return (
    <>
      <AdminNav />
      {/* pages bring their own PageContainer (1080px); admin tables get the full width AppShell gives /admin */}
      <div className="[&>.page-enter]:max-w-none">
        <Outlet />
      </div>
      <AttemptDrawer />
    </>
  );
}
