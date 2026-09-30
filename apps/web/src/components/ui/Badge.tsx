import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';
import { Badge as ShBadge } from './shadcn/badge';
import { Toggle } from './shadcn/toggle';

export type Tone = 'neutral' | 'accent' | 'good' | 'warn' | 'bad' | 'info';

/** Soft background + contrast-safe text per tone (also used by Alert). Every pair is gated by scripts/check-contrast.mjs. */
export const TONE_STYLES: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-muted ring-1 ring-inset ring-line',
  accent: 'bg-accent-soft text-accent-text ring-1 ring-inset ring-brand/15',
  good: 'bg-good-soft text-good-text ring-1 ring-inset ring-good/15',
  warn: 'bg-warn-soft text-warn-text ring-1 ring-inset ring-warn/15',
  bad: 'bg-bad-soft text-bad-text ring-1 ring-inset ring-bad/15',
  info: 'bg-sky-soft text-sky-text ring-1 ring-inset ring-sky/15',
};

/** Static status label. `className="h-auto whitespace-normal py-1"` for multi-line content. */
export function Badge({ tone = 'neutral', className, ...rest }: ComponentProps<'span'> & { tone?: Tone }) {
  return <ShBadge variant="secondary" className={cn('[&>svg]:size-3.5', TONE_STYLES[tone], className)} {...rest} />;
}

/** Toggleable filter chip (Radix Toggle -> aria-pressed). */
export function Chip({ selected, className, ...rest }: Omit<ComponentProps<'button'>, 'onChange'> & { selected?: boolean }) {
  return (
    <Toggle
      pressed={!!selected}
      className={cn(
        'h-8 shrink-0 rounded-sm border px-3 text-caption font-medium max-md:h-11',
        'border-border bg-card text-muted hover:border-input hover:bg-card hover:text-ink',
        'data-[state=on]:border-brand/40 data-[state=on]:bg-accent-soft data-[state=on]:text-accent-text data-[state=on]:hover:text-accent-text',
        className,
      )}
      {...rest}
    />
  );
}
