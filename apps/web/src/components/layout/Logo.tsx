import { cn } from '@/lib/utils';

/** The mark alone: a serif "I" on a teal tile. The same Newsreader as the page titles, so brand and content share one voice. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" className={cn('size-7 shrink-0', className)} aria-hidden>
      <rect width="28" height="28" rx="6" fill="var(--accent)" />
      <text x="14" y="21" textAnchor="middle" fill="var(--accent-ink)" fontFamily="var(--font-serif)" fontSize="21" fontWeight="500">
        I
      </text>
    </svg>
  );
}

/** Wordmark: the mark + the name in one weight, set in the serif. */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5 font-serif text-lg font-medium tracking-[-0.01em]', className)}>
      <LogoMark />
      IELTS Practice
    </span>
  );
}
