import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * The only way a result or dashboard section gets a heading. h2 = `type-heading`, h3 = `type-subheading`; caption mt-1, content mt-4, children space-y-6.
 * Spacing between sections comes from the parent (`space-y-8 md:space-y-12`).
 */
export function Section({ title, level = 2, caption, aside, id, className, children }: { title: ReactNode; level?: 2 | 3; caption?: ReactNode; aside?: ReactNode; id?: string; className?: string; children?: ReactNode }) {
  const auto = useId();
  const hid = `${id ?? auto}-h`;
  const H = level === 2 ? 'h2' : 'h3';
  return (
    <section id={id} aria-labelledby={hid} className={className}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <H id={hid} className={level === 2 ? 'type-heading' : 'type-subheading'}>
            {title}
          </H>
          {caption && <p className="type-caption mt-1 max-w-[68ch]">{caption}</p>}
        </div>
        {aside && <div className="flex shrink-0 items-center gap-2 type-body">{aside}</div>}
      </div>
      {children != null && <div className={cn('mt-4 space-y-6')}>{children}</div>}
    </section>
  );
}
