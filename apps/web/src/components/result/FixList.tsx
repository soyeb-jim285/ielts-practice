import { Check } from 'lucide-react';
import { Button } from '@/components/ui';

export type FixItem = { title: string; why: string; before?: string; after?: string };

/** Numbered fixes. The numeral is the same size as the title; before/after is an inline pair, no grey box. Owns the single "Add all to review deck" action. */
export function FixList({ items, onAddAll, added }: { items: FixItem[]; onAddAll?: () => void; added?: boolean }) {
  return (
    <div className="space-y-4">
      <ol className="space-y-6">
        {items.map((f, i) => (
          <li key={i} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-2">
            <span className="type-subheading type-num" aria-hidden>
              {i + 1}.
            </span>
            <div className="max-w-[68ch] space-y-2">
              <h3 className="type-subheading">{f.title}</h3>
              <p className="type-body">{f.why}</p>
              {(f.before || f.after) && (
                <dl className="space-y-1">
                  {f.before && (
                    <div>
                      <dt className="type-caption">Before</dt>
                      <dd className="type-reading-sm">{f.before}</dd>
                    </div>
                  )}
                  {f.after && (
                    <div>
                      <dt className="type-caption">After</dt>
                      <dd className="type-reading-sm">{f.after}</dd>
                    </div>
                  )}
                </dl>
              )}
            </div>
          </li>
        ))}
      </ol>
      {onAddAll &&
        (added ? (
          <p className="type-body flex items-center gap-2 text-good-text">
            <Check className="size-4" aria-hidden /> Added to review deck
          </p>
        ) : (
          <Button variant="link" onClick={onAddAll}>
            Add all to review deck
          </Button>
        ))}
    </div>
  );
}
