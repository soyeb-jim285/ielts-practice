import { createFileRoute, Link } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { CircleCheck, CircleX, Clock } from 'lucide-react';
import { useEffect } from 'react';
import { Mail } from '@/components/legal/Legal';
import { buttonStyles, EmptyState, PageContainer } from '@/components/ui';

type Status = 'paid' | 'failed' | 'cancelled' | 'pending';

export const Route = createFileRoute('/_app/checkout/done')({
  validateSearch: (s: Record<string, unknown>): { status: Status } => ({ status: s.status === 'paid' || s.status === 'failed' || s.status === 'cancelled' ? s.status : 'pending' }),
  component: Done,
});

/** Where PayStation's return lands (server verified the invoice first, routes/pay.ts). */
function Done() {
  const { status } = Route.useSearch();
  const qc = useQueryClient();
  useEffect(() => {
    if (status === 'paid') void qc.invalidateQueries(); // plan, quota and unlocked tests all change
  }, [status, qc]);

  const home = <Link to="/" className={buttonStyles({ size: 'lg' })}>Start practising</Link>;
  return (
    <PageContainer>
      {status === 'paid' ? (
        <EmptyState icon={<CircleCheck />} title="Payment received. Your paid plan is on." action={home}>
          We have emailed you a confirmation with the date your plan ends.
        </EmptyState>
      ) : status === 'failed' || status === 'cancelled' ? (
        <EmptyState icon={<CircleX />} title={status === 'cancelled' ? 'Payment cancelled' : "The payment didn't go through"} action={<Link to="/checkout" className={buttonStyles({ size: 'lg' })}>Try again</Link>}>
          You were not charged. If money left your account anyway, email <Mail /> with the transaction ID.
        </EmptyState>
      ) : (
        <EmptyState icon={<Clock />} title="We're waiting for your payment to confirm" action={home}>
          This can take a few minutes. Your plan turns on by itself once it does. If it isn&apos;t on within 2 hours, email <Mail /> with the transaction ID.
        </EmptyState>
      )}
    </PageContainer>
  );
}
