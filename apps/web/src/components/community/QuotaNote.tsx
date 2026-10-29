import { quotaText, resetLabel, useQuota, windowWord, type Skill, type SkillQuota, type Tier } from '@/lib/community';
import { Sparkles } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { buttonStyles } from '@/components/ui';
import { cn } from '@/lib/utils';

/** The line that sits with a Start button: "1 test left today". Amber when none is left (the start screen then explains and offers a way out). */
export function QuotaNote({ skill, className }: { skill: Skill; className?: string }) {
  const { data } = useQuota();
  // Keep the row's height while loading so the button does not jump.
  if (!data) return <span aria-hidden className={cn('type-caption block min-h-5', className)} />;
  const { text, warn } = quotaText(data[skill]);
  return (
    <span className={cn('type-caption type-num block min-h-5', warn && 'font-medium text-warn-text', className)} role="status">
      {text}
    </span>
  );
}

function Item({ label, t }: { label: string; t: { text: string; warn: boolean } }) {
  return (
    <div className="min-w-0">
      <dt className="type-caption">{label}</dt>
      <dd className={cn('type-num text-sm font-medium', t.warn ? 'text-warn-text' : 'text-ink')}>{t.text}</dd>
    </div>
  );
}

/** The counters on one line, at the top of the dashboard: what you can start. */
export function QuotaStrip({ className }: { className?: string }) {
  const { data } = useQuota();
  if (!data) return null;
  return (
    <section aria-label="Your tests" className={cn('flex flex-wrap items-end justify-between gap-x-10 gap-y-4 border-y border-line py-4', className)}>
      <dl className="flex flex-wrap gap-x-10 gap-y-3">
        <Item label="Speaking" t={quotaText(data.speaking)} />
        <Item label="Writing" t={quotaText(data.writing)} />
        {data.live && <Item label="Live examiner" t={quotaText(data.examiner)} />}
      </dl>
    </section>
  );
}

const PLAN: Record<Tier, string> = { guest: 'Guest', community: 'Free plan', subscriber: 'Paid plan', unlimited: 'Unlimited' };

function Meter({ label, text, warn = false, frac }: { label: string; text: string; warn?: boolean; frac?: number }) {
  return (
    <li>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-ink">{label}</span>
        <span className={cn('type-num text-right', warn ? 'font-medium text-warn-text' : 'text-muted')}>{text}</span>
      </div>
      {frac != null && (
        <div aria-hidden className="mt-1 h-1 overflow-hidden rounded-full bg-line">
          <div className={cn('h-full rounded-full', warn ? 'bg-warn' : 'bg-brand')} style={{ width: `${Math.min(100, frac * 100)}%` }} />
        </div>
      )}
    </li>
  );
}

function QuotaMeter({ label, s }: { label: string; s: SkillQuota }) {
  const left = s.remaining ?? 0;
  if (s.limit == null) return <Meter label={label} text="Unlimited" />;
  return <Meter label={label} text={left > 0 ? `${left} of ${s.limit} left ${windowWord(s)}` : `None left. ${resetLabel(s.resetAt)}`} warn={left === 0} frac={s.limit > 0 ? left / s.limit : undefined} />;
}

/** Listening and Reading have no usage limit; the plan decides which tests open. */
const LrMeter = ({ label, c }: { label: string; c: { open: number; total: number } }) =>
  c.total > 0 ? <Meter label={label} text={c.open >= c.total ? `All ${c.open} tests` : `${c.open} of ${c.total} tests`} frac={c.open / c.total} /> : null;

function UpgradeButton() {
  return (
    <Link to="/pricing" className={buttonStyles({ variant: 'secondary', size: 'sm', className: 'w-full' })}>
      <Sparkles aria-hidden />
      Upgrade
    </Link>
  );
}

/** Plan and what is left, for the sidebar footer and the mobile More sheet. */
export function UsagePanel({ className }: { className?: string }) {
  const { data } = useQuota();
  if (!data) return null;
  const until = data.subscribedUntil && new Date(data.subscribedUntil).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  return (
    <section aria-label="Your plan and usage" className={cn('space-y-2 text-caption', className)}>
      {data.tier !== 'guest' && ( // a guest's footer already says "Browsing as a guest"
        <p className="flex items-baseline justify-between gap-2">
          <span className="font-medium text-ink">{PLAN[data.tier]}</span>
          {until && <span className="text-muted">until {until}</span>}
        </p>
      )}
      <ul className="space-y-2">
        <QuotaMeter label="Speaking" s={data.speaking} />
        <QuotaMeter label="Writing" s={data.writing} />
        {data.live && <QuotaMeter label="Live examiner" s={data.examiner} />}
        <LrMeter label="Listening" c={data.lr.listening} />
        <LrMeter label="Reading" c={data.lr.reading} />
      </ul>
      {data.tier === 'community' && <UpgradeButton />}
    </section>
  );
}
