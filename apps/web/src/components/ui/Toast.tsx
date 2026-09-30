import { useEffect, useState, type ReactNode } from 'react';
import { toast as sonner } from 'sonner';
import { Toaster as ShToaster } from './shadcn/sonner';

type Opts = { tone?: 'neutral' | 'good' | 'bad'; action?: { label: string; onClick: () => void }; durationMs?: number };

export const dismissToast = (id?: string | number) => sonner.dismiss(id);

/** Fire-and-forget notice (sonner): toast('Saved'), toast('Upload failed', { tone: 'bad', action: { label: 'Retry', onClick } }). */
export function toast(message: ReactNode, { tone = 'neutral', action, durationMs }: Opts = {}) {
  const fn = tone === 'good' ? sonner.success : tone === 'bad' ? sonner.error : sonner;
  return fn(message, { action, duration: durationMs ?? (action ? 8000 : 4000) });
}

const isDark = () => document.documentElement.classList.contains('dark');

/** Mounted once in __root. Follows the `.dark` class on <html>; sits above the mobile tab bar. */
export function Toaster() {
  const [dark, setDark] = useState(isDark);
  useEffect(() => {
    const mo = new MutationObserver(() => setDark(isDark()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => mo.disconnect();
  }, []);
  return <ShToaster theme={dark ? 'dark' : 'light'} position="bottom-center" offset={24} mobileOffset={{ bottom: 'calc(5rem + env(safe-area-inset-bottom))', left: 16, right: 16 }} visibleToasts={3} />;
}
