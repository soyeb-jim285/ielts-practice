import { Monitor, Moon, Sun } from 'lucide-react';
import { useSyncExternalStore } from 'react';
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

// One shared store so every useTheme() consumer (settings toggle, account menu) stays in sync.
let current = read();
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => (listeners.add(l), () => listeners.delete(l));
if (typeof matchMedia !== 'undefined') media().addEventListener('change', () => current === 'system' && apply('system'));

function setTheme(t: Theme) {
  current = t;
  apply(t);
  try {
    if (t === 'system') localStorage.removeItem('theme');
    else localStorage.setItem('theme', t);
  } catch {
    /* private mode: theme still applies for this visit */
  }
  listeners.forEach((l) => l());
}

/** Theme preference (persisted per browser). The pre-paint copy of `apply` lives in index.html. */
export const useTheme = () => [useSyncExternalStore(subscribe, () => current, () => 'system' as Theme), setTheme] as const;

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
