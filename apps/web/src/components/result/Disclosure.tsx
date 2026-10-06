import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * Flat disclosure: hairline above, chevron, no card. The summary holds a heading (h2/h3) so it is in the outline; text is `type-subheading`.
 * Closed by default; pass `defaultOpen` for the weakest criterion or on desktop only.
 */
export function Disclosure({ title, meta, level = 3, defaultOpen, children }: { title: ReactNode; meta?: ReactNode; level?: 2 | 3; defaultOpen?: boolean; children: ReactNode }) {
  const H = level === 2 ? 'h2' : 'h3';
  return (
    <details open={defaultOpen} className="group border-t border-line">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-4 shrink-0 text-muted transition-transform duration-[120ms] group-open:rotate-90" aria-hidden />
        <H className="type-subheading min-w-0">{title}</H>
        {meta && <span className="type-caption type-num ml-auto pl-2">{meta}</span>}
      </summary>
      <div className="space-y-4 pb-4 pl-6">{children}</div>
    </details>
  );
}
