import { useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { cn } from '@/lib/utils';
import { Popover as ShPopover, PopoverAnchor, PopoverContent } from './shadcn/popover';

export type PopoverTriggerProps = {
  /** Anchor for positioning (the popover sits next to this element). */
  ref: RefObject<HTMLButtonElement | null>;
  /** Id of a hidden element whose `showPopover()` opens this popover; kept for callers whose trigger can't take onClick (see EssayHighlights). */
  popoverTarget: string;
  'aria-expanded': boolean;
  'aria-haspopup': 'dialog';
  onClick: () => void;
};

/**
 * Anchored popover on Radix (light-dismiss, Esc, focus return, collision-aware, portalled so never clipped).
 * `trigger` must render a <button> and spread the props onto it.
 * <Popover trigger={(p) => <button {...p}>word</button>}>{(close) => …}</Popover>
 */
export function Popover({
  trigger,
  children,
  align = 'start',
  className,
}: {
  trigger: (props: PopoverTriggerProps) => ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  align?: 'start' | 'center' | 'end';
  className?: string;
}) {
  const id = useId();
  const btn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <ShPopover open={open} onOpenChange={setOpen}>
      <PopoverAnchor virtualRef={btn} />
      {trigger({ ref: btn, popoverTarget: id, 'aria-expanded': open, 'aria-haspopup': 'dialog', onClick: () => setOpen((o) => !o) })}
      {/* ponytail: compat shim so `document.getElementById(popoverTarget).showPopover()` still opens it; drop once callers use onClick. */}
      <span hidden id={id} ref={(el) => void (el && Object.assign(el, { showPopover: () => setOpen(true) }))} />
      <PopoverContent align={align} collisionPadding={8} onOpenAutoFocus={(e) => e.preventDefault()} className={cn('w-max max-w-[min(22rem,calc(100vw-1rem))]', className)}>
        {typeof children === 'function' ? children(close) : children}
      </PopoverContent>
    </ShPopover>
  );
}
