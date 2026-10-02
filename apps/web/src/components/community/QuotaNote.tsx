import { quotaText, useQuota, type Skill } from '@/lib/community';
import { cn } from '@/lib/utils';
import { BalanceMeter } from './BalanceMeter';

/** The line that sits with a Start button: "1 test left today". Amber when none is left (the start screen then explains and offers a way out). */
export function QuotaNote({ skill, className }: { skill: Skill; className?: string }) {
  const { data } = useQuota();
  // Keep the row's height while loading so the button does not jump.
  if (!data) return <span aria-hidden className={cn('type-caption block min-h-5', className)} />;
  const { text, warn } = quotaText(data[skill], data.tier);
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

/** Both counters and the shared balance on one line, at the top of the dashboard: what you can start, and what pays for it. */
export function QuotaStrip({ className }: { className?: string }) {
  const { data } = useQuota();
  if (!data) return null;
  return (
    <section aria-label="Your tests" className={cn('flex flex-wrap items-end justify-between gap-x-10 gap-y-4 border-y border-line py-4', className)}>
      <dl className="flex flex-wrap gap-x-10 gap-y-3">
        <Item label="Speaking" t={quotaText(data.speaking, data.tier)} />
        <Item label="Writing" t={quotaText(data.writing, data.tier)} />
      </dl>
      {data.tier !== 'own-key' && <BalanceMeter className="w-full sm:w-64 md:hidden" />}
    </section>
  );
}
