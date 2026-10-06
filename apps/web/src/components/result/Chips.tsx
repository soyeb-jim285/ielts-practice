import { TONE_STYLES, type Tone } from '@/components/ui';
import { cn } from '@/lib/utils';

export type CountChip = { label: string; count?: number; tone?: Tone; onClick?: () => void };

/** Word/count chips for counts that are mostly 1 (linking words, repeated words): a row of tags, "x3" only when above 1. */
export function CountChips({ items }: { items: CountChip[] }) {
  return (
    <ul className="flex flex-wrap gap-2">
      {items.map((c) => {
        const cls = cn('type-body inline-flex min-h-8 items-center gap-1.5 rounded-sm px-2.5', TONE_STYLES[c.tone ?? 'neutral']);
        const body = (
          <>
            {c.label}
            {c.count != null && c.count > 1 && <span className="type-num">×{c.count}</span>}
          </>
        );
        return (
          <li key={c.label}>
            {c.onClick ? (
              <button type="button" onClick={c.onClick} className={cn(cls, 'hit focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring')}>
                {body}
              </button>
            ) : (
              <span className={cls}>{body}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
export { CountChips as Chips };
