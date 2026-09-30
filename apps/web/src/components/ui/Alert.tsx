import { clsx } from 'clsx';
import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { TONE_STYLES } from './Badge';

const ICONS = { accent: Info, good: CircleCheck, warn: TriangleAlert, bad: CircleAlert };

/** Inline message block (form errors, notices, "analysis failed"). role=alert for bad, status otherwise. */
export function Alert({ tone = 'accent', title, children, action, className }: { tone?: keyof typeof ICONS; title?: ReactNode; children?: ReactNode; action?: ReactNode; className?: string }) {
  const Icon = ICONS[tone];
  return (
    <div role={tone === 'bad' ? 'alert' : 'status'} className={clsx('flex gap-3 rounded-control px-3.5 py-3 text-sm', TONE_STYLES[tone], className)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={clsx(title && 'mt-0.5', 'text-ink/80')}>{children}</div>}
        {action && <div className="mt-2">{action}</div>}
      </div>
    </div>
  );
}
