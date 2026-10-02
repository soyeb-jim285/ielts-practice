import { Link, useRouterState } from '@tanstack/react-router';
import { Alert, buttonStyles } from '@/components/ui';
import { useQuota } from '@/lib/community';
import { useMe } from '@/lib/query';
import { cn } from '@/lib/utils';

/** On a guest's own result page: results are kept for 30 days, an account keeps them for good. Nothing for signed-in users. */
export function KeepResult() {
  const me = useMe().data;
  const redirect = useRouterState({ select: (s) => s.location.href });
  if (!me?.user.isAnonymous) return null;
  return (
    <Alert
      tone="accent"
      title="Create an account to keep this result"
      className="mb-6"
      action={
        <Link to="/signup" search={{ redirect }} className={buttonStyles({ variant: 'outline', size: 'sm' })}>
          Create account
        </Link>
      }
    >
      Guest results are deleted after 30 days. With an account this test is saved, and you get 1 test a day.
    </Alert>
  );
}

/** "This one didn't count against your tests": a failed analysis or a silent recording is refunded by the server. Only people with a test limit care. */
export function RefundNote({ className }: { className?: string }) {
  const { data } = useQuota();
  if (!data || data.tier === 'own-key') return null;
  return <span className={cn('type-caption mt-1 block', className)}>This one didn't count against your tests.</span>;
}
