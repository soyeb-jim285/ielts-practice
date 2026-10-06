import { Fragment, type ReactNode } from 'react';

/** One caption line, items joined by " · " (meta line, "Marked at ..."). Falsy items are skipped. */
export function StatusLine({ items, className }: { items: ReactNode[]; className?: string }) {
  const shown = items.filter((i) => i !== false && i != null && i !== '');
  return (
    <p className={`type-caption type-num ${className ?? ''}`}>
      {shown.map((it, i) => (
        <Fragment key={i}>
          {i > 0 && <span aria-hidden> · </span>}
          {it}
        </Fragment>
      ))}
    </p>
  );
}
