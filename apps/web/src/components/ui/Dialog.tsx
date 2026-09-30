import { X } from 'lucide-react';
import { useSyncExternalStore, type ComponentType, type ReactNode } from 'react';
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
};

const closeButton = (Close: ComponentType<{ asChild?: boolean; children?: ReactNode }>) => (
  <Close asChild>
    <Button variant="ghost" size="icon-sm" aria-label="Close" className="-mt-1 -mr-2 text-muted">
      <X />
    </Button>
  </Close>
);

/** Centered modal (Radix Dialog: focus trap + return, Esc, overlay click). Use for confirmations. */
export function Dialog({ open, onClose, title, description, children, footer, className }: Props) {
  return (
    <ShDialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent showCloseButton={false} className={cn('max-w-md gap-0 rounded-card p-0', className)}>
        <DialogHeader className="flex-row items-start gap-3 px-5 pt-5 pb-3 text-left">
          <div className="min-w-0 flex-1">
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription className="mt-1 text-sm text-muted">{description}</DialogDescription> : <DialogDescription className="sr-only">{title}</DialogDescription>}
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
export function Sheet({ open, onClose, title, description, children, footer, className }: Props) {
  const desktop = useSyncExternalStore(subscribe, () => md().matches, () => false);
  return (
    <ShSheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side={desktop ? 'right' : 'bottom'}
        showCloseButton={false}
        className={cn('gap-0 p-0', desktop ? 'h-dvh w-[420px] max-w-none rounded-l-card sm:max-w-none' : 'max-h-[88dvh] rounded-t-card', className)}
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
