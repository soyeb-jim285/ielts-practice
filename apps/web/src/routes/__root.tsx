import { useQuery, type QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Link, Outlet } from '@tanstack/react-router';
import { Compass } from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { ErrorPage, RouteError } from '@/components/layout/RouteError';
import { Logo } from '@/components/layout/Logo';
import { buttonStyles, Toaster } from '@/components/ui';
import { meQuery } from '@/lib/query';

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: () => (
    <>
      <Outlet />
      <Toaster />
    </>
  ),
  notFoundComponent: NotFound,
  errorComponent: RouteError,
});

/** Unknown URL: inside the app shell (nav stays) when signed in, bare otherwise. */
function NotFound() {
  const me = useQuery(meQuery);
  if (me.isPending) return null;
  if (me.data)
    return (
      <AppShell>
        <ErrorPage icon={<Compass />} title="Page not found" action={<Link to="/" className={buttonStyles({ variant: 'outline' })}>Back to dashboard</Link>}>
          The link may be old or mistyped.
        </ErrorPage>
      </AppShell>
    );
  return (
    <main id="main" className="page-enter grid min-h-dvh content-center px-5 py-12 sm:px-10">
      <div className="mx-auto w-full max-w-sm">
        <Link to="/login" aria-label="IELTS Practice" className="-m-1 inline-flex rounded-md p-1  focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          <Logo />
        </Link>
        <p className="type-num mt-12 font-serif text-7xl leading-none font-medium tracking-tight text-brand-text">404</p>
        <h1 className="type-title mt-4">Page not found</h1>
        <p className="mt-2 type-lede">The link may be old or mistyped. Sign in to get back to your practice.</p>
        <Link to="/login" className={buttonStyles({ size: 'lg', className: 'mt-8 w-full sm:w-auto' })}>
          Go to sign in
        </Link>
      </div>
    </main>
  );
}
