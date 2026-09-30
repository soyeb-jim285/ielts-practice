import { ArrowRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { IconTile } from '@/components/ui';
import { cn } from '@/lib/utils';

/**
 * One row recipe for every list (dashboard, bank, history, mistakes): rows sit directly on the page between hairlines, no card around them.
 * The hover wash is a pseudo-element that bleeds 12px past the text so the text stays on the page grid. `group` children react to hover.
 */
export const rowStyles = cn(
  'group relative isolate flex w-full items-center gap-3.5 rounded-md py-3.5 text-left',
  'before:absolute before:inset-y-0 before:-inset-x-3 before:-z-10 before:rounded-md before:transition-colors before:duration-[120ms] hover:before:bg-hover focus-visible:before:bg-hover',
  'focus-visible:outline-offset-[6px]',
);

/** A list: hairline above and below, rows divided. Give it `stagger` for the entrance. */
export const listStyles = 'divide-y divide-line border-y border-line';

/** Bare 20px icon at the start of a row (skill, action). Turns teal on row hover. */
export const RowIcon = ({ children }: { children: ReactNode }) => <IconTile>{children}</IconTile>;

/** Trailing arrow: appears and nudges right on hover or focus, so the whole row reads as a link without a chevron on every row. */
export const RowChevron = () => (
  <ArrowRight
    className="size-4 shrink-0 -translate-x-1 text-ink opacity-0 transition-[opacity,translate] duration-[120ms] ease-(--ease-out-expo) group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100"
    aria-hidden
  />
);

/** Two-line row text: title (+ optional meta line). */
export const RowText = ({ title, meta }: { title: ReactNode; meta?: ReactNode }) => (
  <span className="min-w-0 flex-1">
    <span className="type-subheading line-clamp-2 block font-medium text-pretty">{title}</span>
    {meta && <span className="type-caption mt-0.5 block line-clamp-2">{meta}</span>}
  </span>
);

/** Heading row of a section: serif title, optional aside (count, "View all") on the right. */
export const PanelHeader = ({ title, meta, id, className }: { title: ReactNode; meta?: ReactNode; id?: string; className?: string }) => (
  <div className={cn('mb-3 flex items-baseline justify-between gap-3', className)}>
    <h2 id={id} className="type-heading">
      {title}
    </h2>
    {meta && <span className="type-caption shrink-0">{meta}</span>}
  </div>
);

/** Link under a list ("Open error log"): teal text, arrow nudges on hover. Put `group` on it and an <ArrowRight> inside. */
export const panelFooterStyles = 'group mt-1 -ml-1 inline-flex h-11 items-center gap-1.5 rounded-md px-1 text-sm font-medium text-accent-text underline-offset-4 hover:underline';

/** Plain text label that splits one list into runs (bank parts, history by day). No bar, no stickiness. */
export const GroupHeading = ({ children, className }: { children: ReactNode; className?: string }) => (
  <h2 className={cn('type-caption pt-7 pb-2 font-medium [section:first-child>&]:pt-0', className)}>{children}</h2>
);
