import { ProgressBar } from '@/components/ui';
import { useBalance, usd, usdLimit } from '@/lib/community';
import { cn } from '@/lib/utils';

/**
 * "Community balance $12.40 of $20" with a thin bar. Neutral, not teal (teal means "act here"); amber under 10 %.
 * Renders nothing until the balance is known, or when the shared key has no spend limit to show.
 */
export function BalanceMeter({ className, hideLabel }: { className?: string; /** Show only the figures (the caller already says what this is). */ hideLabel?: boolean }) {
  const { data } = useBalance();
  if (!data || data.limit == null) return null;
  const { limit, remaining } = data;
  const low = remaining != null && remaining / limit < 0.1;
  const figures = remaining == null ? `of ${usdLimit(limit)}` : `${usd(remaining)} of ${usdLimit(limit)}`;
  return (
    <div className={cn('min-w-0', className)}>
      <p className="flex items-baseline justify-between gap-2 text-caption">
        {!hideLabel && <span className="text-muted">Community balance</span>}
        <span className={cn('type-num font-medium', low ? 'text-warn-text' : 'text-ink')}>{figures}</span>
      </p>
      {remaining != null && <ProgressBar value={remaining / limit} tone={low ? 'warn' : 'neutral'} label={`Community balance: ${figures} left`} className="mt-1.5 h-1" />}
    </div>
  );
}
