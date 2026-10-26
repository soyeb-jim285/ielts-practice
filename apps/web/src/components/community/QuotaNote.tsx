import { quotaText, resetLabel, useQuota, windowWord, type Skill, type SkillQuota, type Tier } from '@/lib/community';
import { Sparkles } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button, Dialog, toast } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
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

/** Payments are not live yet: the request lands in the admin feedback inbox and the owner grants the plan by hand (admin user page). */
function UpgradeButton() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const request = async () => {
    setBusy(true);
    try {
      await api.post('/feedback', { message: 'Upgrade request: I would like the paid plan.', page: location.pathname.slice(0, 300) });
      toast('Request sent. We will email you when your plan is on.', { tone: 'good' });
      setOpen(false);
    } catch (e) {
      toast(e instanceof ApiError && e.status === 429 ? 'You have sent a few messages already. Try again in a while.' : "Couldn't send that. Try again.", { tone: 'bad' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button ref={trigger} variant="secondary" size="sm" className="w-full" icon={<Sparkles />} onClick={() => setOpen(true)}>
        Upgrade
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        returnFocusRef={trigger}
        title="Paid plan"
        description="Payments open soon. Until then, ask for it and we will turn it on for your account."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Not now
            </Button>
            <Button loading={busy} onClick={request}>
              Request the paid plan
            </Button>
          </>
        }
      >
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink">
          <li>Unlimited writing and speaking practice tests</li>
          <li>Live examiner: 5 sessions a day, 40 a month</li>
          <li>Every Listening and Reading test</li>
        </ul>
      </Dialog>
    </>
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
