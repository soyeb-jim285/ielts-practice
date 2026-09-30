import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** One row recipe for every list panel (dashboard, bank, history, mistakes): 20 px gutter, 16 px rhythm, hover wash, inset focus ring. */
export const rowStyles = cn(
  'flex w-full items-center gap-3 px-5 py-4 text-left transition-colors duration-150 hover:bg-hover',
  'focus-visible:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset',
);

/** Round icon well at the start of a row. */
export const RowIcon = ({ children }: { children: ReactNode }) => (
  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-2 text-muted [&_svg]:size-4" aria-hidden>
    {children}
  </span>
);

/** Two-line row text: title (+ optional meta line). */
export const RowText = ({ title, meta }: { title: ReactNode; meta?: ReactNode }) => (
  <span className="min-w-0 flex-1">
    <span className="line-clamp-2 block text-[0.9375rem] font-medium text-pretty">{title}</span>
    {meta && <span className="mt-0.5 block line-clamp-2 text-sm text-muted">{meta}</span>}
  </span>
);

/** Heading row inside a list panel. */
export const PanelHeader = ({ title, meta }: { title: ReactNode; meta?: ReactNode }) => (
  <div className="flex items-baseline justify-between gap-3 px-5 pt-5 pb-3">
    <h2 className="text-base font-semibold">{title}</h2>
    {meta && <span className="text-sm text-muted">{meta}</span>}
  </div>
);
