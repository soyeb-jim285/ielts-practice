import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';
import { Badge as ShBadge } from './shadcn/badge';
import { Toggle } from './shadcn/toggle';

export type Tone = 'neutral' | 'accent' | 'good' | 'warn' | 'bad';

/** Soft background + contrast-safe text per tone (also used by Alert). */
export const TONE_STYLES: Record<Tone, string> = {
  neutral: 'bg-ink/6 text-muted dark:bg-ink/10',
  accent: 'bg-brand-soft text-brand-text',
  good: 'bg-good-soft text-good-text',
  warn: 'bg-warn-soft text-warn-text',
  bad: 'bg-bad-soft text-bad-text',
};

/** Static status label. `className="h-auto whitespace-normal py-1"` for multi-line content. */
export function Badge({ tone = 'neutral', className, ...rest }: ComponentProps<'span'> & { tone?: Tone }) {
  return <ShBadge variant="secondary" className={cn('[&>svg]:size-3.5', TONE_STYLES[tone], className)} {...rest} />;
}

/** Toggleable filter chip (Radix Toggle → aria-pressed). */
export function Chip({ selected, className, ...rest }: Omit<ComponentProps<'button'>, 'onChange'> & { selected?: boolean }) {
  return (
    <Toggle
      pressed={!!selected}
      className={cn(
        'h-9 shrink-0 rounded-full border px-3.5 text-sm font-medium max-md:h-11',
        'border-border bg-card text-muted hover:border-input hover:bg-card hover:text-ink',
        'data-[state=on]:border-transparent data-[state=on]:bg-ink data-[state=on]:text-background data-[state=on]:hover:text-background',
        className,
      )}
      {...rest}
    />
  );
}
