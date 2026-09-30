import { clsx } from 'clsx';
import { Info } from 'lucide-react';
import { cloneElement, useId, type ReactElement, type ReactNode } from 'react';

/**
 * Hover/focus hint for a focusable child (button, link). Plain text only; interactive content → Popover.
 * ponytail: CSS-positioned, can clip inside overflow:hidden parents; switch to Popover there.
 */
export function Tooltip({ content, children, side = 'top' }: { content: ReactNode; children: ReactElement<{ 'aria-describedby'?: string }>; side?: 'top' | 'bottom' }) {
  const id = useId();
  return (
    <span className="group/tt relative inline-flex">
      {cloneElement(children, { 'aria-describedby': id })}
      <span
        id={id}
        role="tooltip"
        className={clsx(
          'pointer-events-none absolute left-1/2 z-[80] w-max max-w-64 -translate-x-1/2 rounded-lg bg-ink px-2.5 py-1.5 text-xs leading-snug font-normal text-bg opacity-0 shadow-pop transition-opacity duration-150',
          'group-hover/tt:opacity-100 group-has-focus-visible/tt:opacity-100',
          side === 'top' ? 'bottom-full mb-2' : 'top-full mt-2',
        )}
      >
        {content}
      </span>
    </span>
  );
}

/** ⓘ button with an explanation tooltip, for metrics and jargon. */
export function InfoTip({ children, label = 'More info' }: { children: ReactNode; label?: string }) {
  return (
    <Tooltip content={children}>
      <button type="button" aria-label={label} className="inline-grid size-5 place-items-center rounded-full text-muted hover:text-ink">
        <Info className="size-3.5" />
      </button>
    </Tooltip>
  );
}
