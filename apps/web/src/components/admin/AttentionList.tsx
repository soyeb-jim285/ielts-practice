import { Link } from '@tanstack/react-router';
import { AlertTriangle, ChevronRight, CircleCheck, Info, OctagonAlert } from 'lucide-react';
import type { Attention } from './logic';
import { cn } from '@/lib/utils';

const ICON = { bad: OctagonAlert, warn: AlertTriangle, info: Info };
const TXT = { bad: 'text-bad-text', warn: 'text-warn-text', info: 'text-sky-text' };
const WORD = { bad: 'Broken', warn: 'Watch', info: 'New' };

/** "Needs attention": one line per problem with a status word (never colour alone) and a link to where it is fixed. Quiet single line when there is nothing. Max 5 shown. */
export function AttentionList({ items, loading }: { items: Attention[]; loading?: boolean }) {
  if (loading) return <div className="h-10 animate-pulse rounded-lg bg-surface-2" aria-busy />;
  if (!items.length)
    return (
      <p className="flex items-center gap-2 text-sm text-muted">
        <CircleCheck aria-hidden className="size-4 text-good" /> Nothing needs attention.
      </p>
    );
  const shown = items.slice(0, 5);
  return (
    <section aria-label="Needs attention" className="overflow-hidden rounded-lg border border-line bg-surface">
      <h2 className="border-b border-line px-4 py-2 text-sm font-semibold">Needs attention <span className="type-num font-normal text-muted">({items.length})</span></h2>
      <ul className="divide-y divide-line">
        {shown.map((a) => {
          const Icon = ICON[a.tone];
          return (
            <li key={a.id}>
              <Link to={a.to} className="flex min-h-11 items-center gap-3 px-4 py-2.5 text-sm hover:bg-surface-2">
                <Icon aria-hidden className={cn('size-4 shrink-0', TXT[a.tone])} />
                <span className={cn('w-14 shrink-0 text-xs font-semibold uppercase tracking-wide', TXT[a.tone])}>{WORD[a.tone]}</span>
                <span className="min-w-0 flex-1">{a.text}</span>
                <ChevronRight aria-hidden className="size-4 shrink-0 text-muted" />
              </Link>
            </li>
          );
        })}
      </ul>
      {items.length > 5 && <p className="border-t border-line px-4 py-2 text-xs text-muted">and {items.length - 5} more</p>}
    </section>
  );
}
