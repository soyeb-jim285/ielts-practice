import { useEffect, useState } from 'react';
import { Toaster as ShToaster } from './shadcn/sonner';

const isDark = () => document.documentElement.classList.contains('dark');

/** The real toaster (lazy-loaded by Toast.tsx). Follows the `.dark` class on <html>; sits above the mobile tab bar. */
export default function ToasterView({ onReady }: { onReady: () => void }) {
  const [dark, setDark] = useState(isDark);
  useEffect(() => {
    const mo = new MutationObserver(() => setDark(isDark()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    onReady();
    return () => mo.disconnect();
  }, [onReady]);
  return <ShToaster theme={dark ? 'dark' : 'light'} position="bottom-center" offset={24} mobileOffset={{ bottom: 'calc(5rem + env(safe-area-inset-bottom))', left: 16, right: 16 }} visibleToasts={3} />;
}
