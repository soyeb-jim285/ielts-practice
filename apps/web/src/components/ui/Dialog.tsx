import { clsx } from 'clsx';
import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';

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

function Base({ open, onClose, title, description, children, footer, className, sheet }: Props & { sheet?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const d = ref.current;
    if (open && !d?.open) d?.showModal();
    if (!open && d?.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      data-sheet={sheet || undefined}
      aria-labelledby={`${id}-t`}
      aria-describedby={description ? `${id}-d` : undefined}
      onClose={onClose}
      // Click on the backdrop (the <dialog> itself, outside the inner panel) closes.
      onClick={(e) => e.target === ref.current && onClose()}
      className={clsx(
        'z-50 border border-line bg-surface p-0 text-ink shadow-pop backdrop:backdrop-blur-[2px]',
        sheet
          ? 'mx-0 mt-auto mb-0 max-h-[88dvh] w-full max-w-none rounded-t-card md:mt-0 md:mr-0 md:ml-auto md:h-dvh md:max-h-none md:w-[420px] md:rounded-none md:rounded-l-card'
          : 'm-auto w-[calc(100%-2rem)] max-w-md rounded-card',
        className,
      )}
    >
      {open && (
        <div className={clsx('flex flex-col', sheet && 'max-h-[inherit] md:h-full')}>
          <header className="flex items-start gap-3 px-5 pt-5 pb-3">
            <div className="min-w-0 flex-1">
              <h2 id={`${id}-t`} className="text-lg font-semibold">
                {title}
              </h2>
              {description && (
                <p id={`${id}-d`} className="mt-1 text-sm text-muted">
                  {description}
                </p>
              )}
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="-mt-1 -mr-2 grid size-9 place-items-center rounded-control text-muted hover:bg-ink/5 hover:text-ink">
              <X className="size-5" />
            </button>
          </header>
          {children && <div className={clsx('px-5', sheet && !footer ? 'pb-[max(1.25rem,env(safe-area-inset-bottom))]' : 'pb-5', sheet && 'min-h-0 flex-1 overflow-y-auto')}>{children}</div>}
          {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}

/** Centered modal (native <dialog>: focus trap, Esc, backdrop click all built in). Use for confirmations. */
export const Dialog = (p: Props) => <Base {...p} />;
/** Bottom sheet on mobile, right-side panel on ≥md. Use for details (error explanation, filters, "More" menu). */
export const Sheet = (p: Props) => <Base {...p} sheet />;
