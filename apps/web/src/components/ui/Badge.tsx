import { clsx } from 'clsx';
import type { ButtonHTMLAttributes, HTMLAttributes } from 'react';

export type Tone = 'neutral' | 'accent' | 'good' | 'warn' | 'bad';

export const TONE_STYLES: Record<Tone, string> = {
  neutral: 'bg-ink/6 text-muted dark:bg-ink/10',
  accent: 'bg-accent-soft text-accent-text',
  good: 'bg-good-soft text-good-text',
  warn: 'bg-warn-soft text-warn-text',
  bad: 'bg-bad-soft text-bad-text',
};

/** Static status label. */
export function Badge({ tone = 'neutral', className, ...rest }: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={clsx('inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-xs font-medium whitespace-nowrap [&_svg]:size-3.5', TONE_STYLES[tone], className)}
      {...rest}
    />
  );
}

/** Toggleable filter chip (aria-pressed). */
export function Chip({ selected, className, type = 'button', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean }) {
  return (
    <button
      type={type}
      aria-pressed={selected}
      className={clsx(
        'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm font-medium whitespace-nowrap transition-colors duration-150 [&_svg]:size-4',
        selected ? 'border-transparent bg-ink text-bg' : 'border-line bg-surface text-muted hover:border-line-strong hover:text-ink',
        className,
      )}
      {...rest}
    />
  );
}
