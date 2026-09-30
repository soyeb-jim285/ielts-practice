import { clsx } from 'clsx';
import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';

export type PopoverTriggerProps = {
  ref: RefObject<HTMLButtonElement | null>;
  popoverTarget: string;
  'aria-expanded': boolean;
  'aria-haspopup': 'dialog';
};

/**
 * Anchored popover on the native Popover API (light-dismiss, Esc, top layer so never clipped).
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
  const pop = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const close = () => pop.current?.hidePopover();

  const place = () => {
    const a = btn.current?.getBoundingClientRect();
    const p = pop.current;
    if (!a || !p) return;
    const w = p.offsetWidth;
    const h = p.offsetHeight;
    let left = align === 'start' ? a.left : align === 'end' ? a.right - w : a.left + a.width / 2 - w / 2;
    left = Math.max(8, Math.min(left, innerWidth - w - 8));
    const below = a.bottom + 6;
    const top = below + h > innerHeight - 8 && a.top - h - 6 > 8 ? a.top - h - 6 : below; // flip above when no room
    p.style.left = `${left}px`;
    p.style.top = `${top}px`;
  };

  // ponytail: closes on scroll/resize instead of tracking the anchor; add CSS anchor positioning when all targets support it.
  useEffect(() => {
    if (!open) return;
    const h = () => close();
    addEventListener('resize', h);
    addEventListener('scroll', h, true);
    return () => {
      removeEventListener('resize', h);
      removeEventListener('scroll', h, true);
    };
  }, [open]);

  return (
    <>
      {trigger({ ref: btn, popoverTarget: id, 'aria-expanded': open, 'aria-haspopup': 'dialog' })}
      <div
        ref={pop}
        id={id}
        popover="auto"
        role="dialog"
        onToggle={(e) => {
          const isOpen = (e.nativeEvent as ToggleEvent).newState === 'open';
          if (isOpen) place();
          setOpen(isOpen);
        }}
        className={clsx('m-0 w-max max-w-[min(22rem,calc(100vw-1rem))] rounded-card border border-line bg-surface p-4 text-sm shadow-pop [inset:auto]', className)}
      >
        {open && (typeof children === 'function' ? children(close) : children)}
      </div>
    </>
  );
}
