import { Link, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { Compass, TriangleAlert } from 'lucide-react';
import { Button, buttonStyles, EmptyState } from '@/components/ui';
import { ApiError } from '@/lib/api';

const home = (
  <Link to="/" className={buttonStyles({ variant: 'secondary' })}>
    Back to dashboard
  </Link>
);

/** Route error view. As the router default it renders inside the parent layout, so AppShell nav stays. A 404 can't be retried. */
export function RouteError({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  if (error instanceof ApiError && error.status === 404)
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <EmptyState icon={<Compass />} title="Not found" action={home}>
          {error.message || 'This page may have been deleted, or the link is old.'}
        </EmptyState>
      </div>
    );
  return (
    <div className="mx-auto max-w-lg px-4 py-16">
      <EmptyState
        icon={<TriangleAlert />}
        title="Something went wrong"
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button
              onClick={() => {
                reset();
                void router.invalidate();
              }}
            >
              Try again
            </Button>
            {home}
          </div>
        }
      >
        {(error instanceof Error && error.message) || 'An unexpected error occurred.'}
      </EmptyState>
    </div>
  );
}
