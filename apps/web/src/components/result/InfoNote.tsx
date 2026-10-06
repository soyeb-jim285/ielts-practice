import { Info } from 'lucide-react';
import type { ReactNode } from 'react';
import { Popover } from '@/components/ui';

/** Info button that opens a popover (tap, click or Enter; works on touch). Use instead of `title=` for any content that matters. `label` is the accessible name. */
export function InfoNote({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Popover trigger={({ popoverTarget: _t, ...p }) => (
      <button type="button" aria-label={label} {...p} className="hit inline-grid size-5 shrink-0 place-items-center rounded-full text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        <Info className="size-4" aria-hidden />
      </button>
    )}>
      <div className="type-body space-y-2">{children}</div>
    </Popover>
  );
}
