import { Link, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { Compass, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button, buttonStyles, EmptyState, PageContainer } from '@/components/ui';
import { ApiError } from '@/lib/api';

const home = (
  <Link to="/" className={buttonStyles({ variant: 'outline' })}>
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

/** One recipe for not-found and error pages: icon, title, one sentence, actions. Also used by the root 404. */
export function ErrorPage({ icon, title, children, action }: { icon: ReactNode; title: string; children: ReactNode; action: ReactNode }) {
  return (
    <PageContainer className="py-8 md:py-16">
      <EmptyState icon={icon} title={title} action={action}>
        {children}
      </EmptyState>
    </PageContainer>
  );
}

/** Route error view. As the router default it renders inside the parent layout, so AppShell nav stays. A 404 can't be retried. */
export function RouteError({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  if (error instanceof ApiError && error.status === 404) {
    const { title, body } = notFoundCopy(error.message);
    return (
      <ErrorPage icon={<Compass />} title={title} action={home}>
        {body}
      </ErrorPage>
    );
  }
  return (
    <ErrorPage
      icon={<TriangleAlert />}
      title="Something went wrong"
      action={
        <div className="flex flex-wrap gap-2">
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
    </ErrorPage>
  );
}
