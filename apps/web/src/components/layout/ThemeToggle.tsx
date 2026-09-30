import { Monitor, Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Segmented } from '@/components/ui';

export type Theme = 'light' | 'dark' | 'system';
const media = () => matchMedia('(prefers-color-scheme: dark)');

function read(): Theme {
  try {
    const t = localStorage.getItem('theme');
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch {
    return 'system';
  }
}

const apply = (t: Theme) => document.documentElement.classList.toggle('dark', t === 'dark' || (t === 'system' && media().matches));

/** Theme preference (persisted per browser). The pre-paint copy of `apply` lives in index.html. */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(read);
  useEffect(() => {
    apply(theme);
    try {
      if (theme === 'system') localStorage.removeItem('theme');
      else localStorage.setItem('theme', theme);
    } catch {
      /* private mode: theme still applies for this visit */
    }
    if (theme !== 'system') return;
    const m = media();
    const h = () => apply('system');
    m.addEventListener('change', h);
    return () => m.removeEventListener('change', h);
  }, [theme]);
  return [theme, setTheme] as const;
}

export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useTheme();
  return (
    <Segmented
      label="Theme"
      size="sm"
      className={className}
      value={theme}
      onChange={setTheme}
      options={[
        { value: 'light', label: <Sun />, 'aria-label': 'Light' },
        { value: 'system', label: <Monitor />, 'aria-label': 'System' },
        { value: 'dark', label: <Moon />, 'aria-label': 'Dark' },
      ]}
    />
  );
}
