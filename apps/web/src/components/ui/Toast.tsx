import { clsx } from 'clsx';
import { CircleAlert, CircleCheck, X } from 'lucide-react';
import { useSyncExternalStore, type ReactNode } from 'react';

type ToastItem = { id: number; message: ReactNode; tone: 'neutral' | 'good' | 'bad'; action?: { label: string; onClick: () => void } };

let items: ToastItem[] = [];
let nextId = 1;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export function dismissToast(id: number) {
  items = items.filter((t) => t.id !== id);
  emit();
}

/** Fire-and-forget notice: toast('Saved'), toast('Upload failed', { tone: 'bad', action: { label: 'Retry', onClick } }). */
export function toast(message: ReactNode, opts: { tone?: ToastItem['tone']; action?: ToastItem['action']; durationMs?: number } = {}) {
  const id = nextId++;
  items = [...items.slice(-2), { id, message, tone: opts.tone ?? 'neutral', action: opts.action }];
  emit();
  setTimeout(() => dismissToast(id), opts.durationMs ?? (opts.action ? 8000 : 4000));
  return id;
}

/** Mounted once in __root. */
export function Toaster() {
  const list = useSyncExternalStore(
    (f) => (subs.add(f), () => subs.delete(f)),
    () => items,
  );
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-[70] flex flex-col items-center gap-2 px-4 md:bottom-6">
      {list.map((t) => (
        <div
          key={t.id}
          role={t.tone === 'bad' ? 'alert' : 'status'}
          className="pointer-events-auto flex w-full max-w-sm animate-[toast-in_200ms_var(--ease-out-quart)] items-center gap-3 rounded-card border border-line bg-surface py-2.5 pr-2 pl-4 text-sm shadow-pop"
        >
          {t.tone === 'good' && <CircleCheck className="size-4 shrink-0 text-good" aria-hidden />}
          {t.tone === 'bad' && <CircleAlert className="size-4 shrink-0 text-bad" aria-hidden />}
          <div className="min-w-0 flex-1">{t.message}</div>
          {t.action && (
            <button
              type="button"
              className="rounded-control px-2 py-1 font-medium text-accent-text hover:bg-accent-soft"
              onClick={() => {
                t.action!.onClick();
                dismissToast(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button type="button" aria-label="Dismiss" onClick={() => dismissToast(t.id)} className={clsx('grid size-8 place-items-center rounded-control text-muted hover:bg-ink/5 hover:text-ink')}>
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
