import { createFileRoute, notFound, Outlet } from '@tanstack/react-router';
import { AdminNav } from '@/components/admin/AdminNav';
import { AttemptDrawer } from '@/components/admin/AttemptDrawer';
import { meQuery } from '@/lib/query';

/** Owner-only area (docs/admin/DESIGN.md): invisible, so a non-owner gets the plain not-found page. Side rail (pills on phones), then the page. A `?attempt=<id>` on any admin URL opens that attempt's cost drawer. */
export const Route = createFileRoute('/_app/admin')({
  beforeLoad: async ({ context }) => {
    const me = (await context.queryClient.ensureQueryData(meQuery)) as { isOwner?: boolean } | null;
    if (!me?.isOwner) throw notFound();
  },
  component: AdminLayout,
});

function AdminLayout() {
  return (
    <div className="mx-auto w-full max-w-[1320px] lg:grid lg:grid-cols-[10.5rem_minmax(0,1fr)] lg:gap-10">
      <AdminNav />
      {/* pages bring their own PageContainer (1080px); inside the rail layout they fill the column instead */}
      <div className="min-w-0 [&>.page-enter]:max-w-none">
        <Outlet />
      </div>
      <AttemptDrawer />
    </div>
  );
}
