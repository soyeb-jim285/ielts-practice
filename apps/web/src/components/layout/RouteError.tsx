import { Link, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { Compass, TriangleAlert } from 'lucide-react';
import { Button, buttonStyles, EmptyState } from '@/components/ui';
import { ApiError } from '@/lib/api';

const home = (
  <Link to="/" className={buttonStyles({ variant: 'secondary' })}>
    Back to dashboard
  </Link>
);

// Server 404 messages ("Attempt not found", "Prompt not found", …) → what the user can do about it.
const NOT_FOUND = [
  { re: /^attempt/i, title: 'Result not found', body: 'This result was deleted or belongs to another account.' },
  { re: /^prompt/i, title: 'Prompt not found', body: 'This prompt was removed or isn’t available on your account.' },
  { re: /^live session/i, title: 'Session not found', body: 'This live session has ended or belongs to another account.' },
];
export const notFoundCopy = (message: string) =>
  NOT_FOUND.find((n) => n.re.test(message)) ?? { title: 'Not found', body: 'This page may have been deleted, or the link is old.' };

/** Route error view. As the router default it renders inside the parent layout, so AppShell nav stays. A 404 can't be retried. */
export function RouteError({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  if (error instanceof ApiError && error.status === 404) {
    const { title, body } = notFoundCopy(error.message);
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <EmptyState icon={<Compass />} title={title} action={home}>
          {body}
        </EmptyState>
      </div>
    );
  }
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
