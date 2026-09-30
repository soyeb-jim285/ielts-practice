import type { Fix } from '@server/ai/types';

/** One "thing to fix next" row (lives inside a divided panel): numeral, title, why it limits the band, and the before and after wording in the reading serif. Props: fix, n (1-based). */
export function FixCard({ fix, n }: { fix: Fix; n: number }) {
  return (
    <div className="flex gap-4 py-6 md:gap-6">
      <span aria-hidden className="type-num w-5 shrink-0 font-serif text-3xl leading-none text-muted md:w-7">
        {n}
      </span>
      <div className="min-w-0 max-w-[68ch] flex-1 space-y-3">
        <div>
          <h3 className="type-subheading">{fix.title}</h3>
          <p className="type-lede mt-1">{fix.why}</p>
        </div>
        <dl className="grid grid-cols-[3.25rem_minmax(0,1fr)] items-baseline gap-x-3 gap-y-2 rounded-md bg-surface-2 px-4 py-3">
          <dt className="type-caption">Before</dt>
          <dd className="type-reading-sm text-muted line-through decoration-bad/60">{fix.before}</dd>
          <dt className="type-caption">After</dt>
          <dd className="type-reading-sm font-medium text-good-text">{fix.after}</dd>
        </dl>
      </div>
    </div>
  );
}
