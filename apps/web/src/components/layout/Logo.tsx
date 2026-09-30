import { cn } from '@/lib/utils';

/** Wordmark: a small waveform tile + name. */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5 text-base font-semibold tracking-tight', className)}>
      <svg viewBox="0 0 32 32" className="size-7 shrink-0" aria-hidden>
        <rect width="32" height="32" rx="8" fill="var(--accent)" />
        <path d="M9 20v-8M13 23V9M17 19v-6M21 22V10M25 18v-4" stroke="var(--accent-ink)" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
      <span>
        IELTS <span className="font-serif font-medium italic">Practice</span>
      </span>
    </span>
  );
}
