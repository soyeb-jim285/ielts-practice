import { Link } from '@tanstack/react-router';
import { ArrowRight } from 'lucide-react';
import { listStyles, rowStyles } from '@/components/bank/ListRow';
import { Section } from '@/components/result';
import { ProgressBar } from '@/components/ui';
import { categoryLabel } from '@/lib/result';
import { cn } from '@/lib/utils';
import type { Progress } from './criteria';

const linkStyles = 'inline-flex min-h-11 items-center gap-1.5 font-medium text-accent-text underline underline-offset-4 hover:no-underline';

/** What you keep getting wrong: top five mistake categories of the last 30 days, then the error log (the review deck lives in Next up). Hidden when there is nothing to fix. */
export function FixNext({ mistakes }: { mistakes: Progress['topMistakes'] }) {
  if (!mistakes.length) return null;
  const max = Math.max(1, ...mistakes.map((m) => m.count));
  return (
    <Section title="Fix next" id="fix" caption={mistakes.length ? 'Recurring mistakes, last 30 days' : undefined}>
      {mistakes.length > 0 && (
        <ul className={cn(listStyles, 'stagger max-w-[68ch]')}>
          {mistakes.map((m) => (
            <li key={m.category}>
              <Link to="/mistakes" search={{ category: m.category }} className={cn(rowStyles, 'flex-col items-stretch justify-center gap-2 py-3')}>
                <span className="flex items-baseline justify-between gap-4 type-body">
                  <span className="min-w-0 truncate">{categoryLabel(m.category)}</span>
                  <span className="type-num w-14 shrink-0 text-right">{m.count}</span>
                </span>
                <ProgressBar value={m.count / max} tone="neutral" label={`${categoryLabel(m.category)}: ${m.count}`} className="h-1" />
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="type-body flex flex-wrap gap-x-6">
        {mistakes.length > 0 && (
          <Link to="/mistakes" className={`group ${linkStyles}`}>
            Open error log <ArrowRight className="size-4 transition-transform duration-[120ms] group-hover:translate-x-0.5" aria-hidden />
          </Link>
        )}
      </p>
    </Section>
  );
}
