import { bdt, PAID_PLANS, type PaidPlan } from '@ielts/core';
import { Link } from '@tanstack/react-router';
import { Check } from 'lucide-react';
import { buttonStyles, Card } from '@/components/ui';

/** What a free account gets (quota.ts PLANS.community, LR_PLANS). */
export const FREE = ['5 Writing tests a week', '10 recorded Speaking tests a month', '5 live examiner sessions a month', 'most Listening and Reading tests'];
/** What the paid plan adds (quota.ts PLANS.subscriber). */
export const PAID = ['Unlimited Writing tests', 'Unlimited recorded Speaking tests', 'Live examiner: 5 a day, 40 a month', 'Every Listening and Reading test'];

export function Features({ items }: { items: string[] }) {
  return (
    <ul className="mt-4 space-y-2 text-sm">
      {items.map((f) => (
        <li key={f} className="flex gap-2">
          <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-accent-text" />
          {f}
        </li>
      ))}
    </ul>
  );
}

function PlanCard({ plan, as: H }: { plan: PaidPlan; as: 'h2' | 'h3' }) {
  const p = PAID_PLANS[plan];
  const best = plan === 'quarter';
  return (
    <Card tone={best ? 'hero' : 'default'} className="flex flex-col">
      <H className="type-heading">{p.label}</H>
      <p className="mt-2">
        <span className="type-num text-3xl font-semibold text-ink">{bdt(p.bdt)}</span>
        <span className="text-sm text-muted"> BDT, one payment</span>
      </p>
      <p className="type-caption mt-1">{best ? `${bdt(Math.round(p.bdt / 3))} a month, save ${bdt(PAID_PLANS.month.bdt * 3 - p.bdt)}` : 'No auto-renewal'}</p>
      <Features items={PAID} />
      <Link to="/checkout" search={{ plan }} className={buttonStyles({ variant: best ? 'primary' : 'secondary', className: 'mt-6 w-full' })}>
        Buy {p.label}
      </Link>
    </Card>
  );
}

/** The two paid plans side by side, prices in BDT. */
export function PlanCards({ heading = 'h3' }: { heading?: 'h2' | 'h3' }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <PlanCard plan="month" as={heading} />
      <PlanCard plan="quarter" as={heading} />
    </div>
  );
}
