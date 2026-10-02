import { X } from 'lucide-react';
import { useRef, useSyncExternalStore, type ComponentType, type ReactNode, type RefObject } from 'react';
import { cn } from '@/lib/utils';
import { Button } from './Button';
import { Dialog as ShDialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './shadcn/dialog';
import { Sheet as ShSheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from './shadcn/sheet';

type Props = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** Right-aligned action row, e.g. Cancel + Confirm buttons. */
  footer?: ReactNode;
  className?: string;
  /** Element to focus on close. Needed when no Radix Trigger opens the overlay (a plain button with onClick), otherwise focus falls to <body>. */
  returnFocusRef?: RefObject<HTMLElement | null>;
};

/**
 * Focus return for overlays opened by a plain button (no Radix Trigger): remember what had focus at the moment of opening and put it
 * back on close. `returnFocusRef` overrides that when the opener is not the focused element (e.g. a tab-bar "More" button).
 */
function useReturnFocus(open: boolean, ref?: RefObject<HTMLElement | null>) {
  const opener = useRef<Element | null>(null);
  const wasOpen = useRef(false);
  if (open && !wasOpen.current) opener.current = document.activeElement; // ponytail: during render, before Radix moves focus into the overlay
  wasOpen.current = open;
  return (e: Event) => {
    const el = ref?.current ?? opener.current;
    if (el instanceof HTMLElement && el !== document.body && el.isConnected) {
      e.preventDefault();
      el.focus();
    }
  };
}

const closeButton = (Close: ComponentType<{ asChild?: boolean; children?: ReactNode }>) => (
  <Close asChild>
    <Button variant="ghost" size="icon-sm" aria-label="Close" className="-mt-1 -mr-2 text-muted">
      <X />
    </Button>
  </Close>
);

/** Centered modal (Radix Dialog: focus trap + return, Esc, overlay click). Use for confirmations. */
export function Dialog({ open, onClose, title, description, children, footer, className, returnFocusRef }: Props) {
  const returnFocus = useReturnFocus(open, returnFocusRef);
  return (
    <ShDialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent showCloseButton={false} onCloseAutoFocus={returnFocus} className={cn('max-w-[min(28rem,calc(100%-2rem))] gap-0 rounded-lg p-0', className)}>
        <DialogHeader className="flex-row items-start gap-3 px-5 pt-5 pb-3 text-left">
          <div className="min-w-0 flex-1">
            <DialogTitle className="leading-snug">{title}</DialogTitle>
            {description ? <DialogDescription className="mt-1.5 text-sm text-muted">{description}</DialogDescription> : <DialogDescription className="sr-only">{title}</DialogDescription>}
          </div>
          {closeButton(DialogClose)}
        </DialogHeader>
        {children && <div className="px-5 pb-5">{children}</div>}
        {footer && <DialogFooter className="flex-row flex-wrap justify-end gap-2 border-t border-border px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">{footer}</DialogFooter>}
      </DialogContent>
    </ShDialog>
  );
}

const md = () => matchMedia('(min-width: 48rem)');
const subscribe = (f: () => void) => (md().addEventListener('change', f), () => md().removeEventListener('change', f));

/** Bottom sheet on mobile, right-side panel on ≥md. Use for details (error explanation, filters, "More" menu). */
export function Sheet({ open, onClose, title, description, children, footer, className, returnFocusRef }: Props) {
  const returnFocus = useReturnFocus(open, returnFocusRef);
  const desktop = useSyncExternalStore(subscribe, () => md().matches, () => false);
  return (
    <ShSheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side={desktop ? 'right' : 'bottom'}
        showCloseButton={false}
        onCloseAutoFocus={returnFocus}
        className={cn('gap-0 p-0', desktop ? 'h-dvh w-[420px] max-w-none rounded-l-lg sm:max-w-none' : 'max-h-[88dvh] rounded-t-lg', className)}
      >
        <SheetHeader className="flex-row items-start gap-3 px-5 pt-5 pb-3">
          <div className="min-w-0 flex-1">
            <SheetTitle className="text-lg">{title}</SheetTitle>
            {description ? <SheetDescription className="mt-1 text-muted">{description}</SheetDescription> : <SheetDescription className="sr-only">{title}</SheetDescription>}
          </div>
          {closeButton(SheetClose)}
        </SheetHeader>
        {children && <div className={cn('min-h-0 flex-1 overflow-y-auto px-5', footer ? 'pb-5' : 'pb-[max(1.25rem,env(safe-area-inset-bottom))]')}>{children}</div>}
        {footer && <SheetFooter className="mt-0 flex-row flex-wrap justify-end gap-2 border-t border-border px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">{footer}</SheetFooter>}
      </SheetContent>
    </ShSheet>
  );
}
