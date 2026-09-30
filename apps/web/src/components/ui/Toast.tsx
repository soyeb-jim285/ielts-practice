import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';

type Opts = { tone?: 'neutral' | 'good' | 'bad'; action?: { label: string; onClick: () => void }; durationMs?: number };

/*
 * sonner + its themed <Toaster> (~25 KB gzip) load on the first notice, not with the entry: /login and every route that never toasts skip them.
 * toast() asks the mounted <Toaster> shell to load the view, waits until it is listening, then publishes.
 */
const View = lazy(() => import('./ToasterView'));
let open = () => {};
let ready: () => void = () => {};
const listening = new Promise<void>((res) => (ready = res));

export const dismissToast = (id?: string | number) => void import('sonner').then((m) => m.toast.dismiss(id));

/** Fire-and-forget notice (sonner): toast('Saved'), toast('Upload failed', { tone: 'bad', action: { label: 'Retry', onClick } }). */
export function toast(message: ReactNode, { tone = 'neutral', action, durationMs }: Opts = {}) {
  open();
  void Promise.all([listening, import('sonner')]).then(([, { toast: sonner }]) => {
    const fn = tone === 'good' ? sonner.success : tone === 'bad' ? sonner.error : sonner;
    fn(message, { action, duration: durationMs ?? (action ? 8000 : 4000) });
  });
}

/** Mounted once in __root; renders nothing until the first toast. */
export function Toaster() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    open = () => setOn(true);
    return () => {
      open = () => {};
    };
  }, []);
  return on ? (
    <Suspense fallback={null}>
      <View onReady={ready} />
    </Suspense>
  ) : null;
}
