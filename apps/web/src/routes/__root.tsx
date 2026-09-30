import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Link, Outlet } from '@tanstack/react-router';
import { Compass } from 'lucide-react';
import { RouteError } from '@/components/layout/RouteError';
import { buttonStyles, EmptyState, Toaster } from '@/components/ui';

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: () => (
    <>
      <Outlet />
      <Toaster />
    </>
  ),
  notFoundComponent: () => (
    <div className="mx-auto max-w-lg px-4 py-24">
      <EmptyState icon={<Compass />} title="Page not found" action={<Link to="/" className={buttonStyles({ variant: 'secondary' })}>Back to dashboard</Link>}>
        The link may be old or mistyped.
      </EmptyState>
    </div>
  ),
  errorComponent: RouteError,
});
