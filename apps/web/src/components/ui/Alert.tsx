import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { TONE_STYLES } from './Badge';
import { Alert as ShAlert, AlertDescription, AlertTitle } from './shadcn/alert';

const ICONS = { accent: Info, good: CircleCheck, warn: TriangleAlert, bad: CircleAlert };

/** Inline message block (form errors, notices, "analysis failed"). role=alert for bad, status otherwise. */
export function Alert({ tone = 'accent', title, children, action, className }: { tone?: keyof typeof ICONS; title?: ReactNode; children?: ReactNode; action?: ReactNode; className?: string }) {
  const Icon = ICONS[tone];
  return (
    <ShAlert role={tone === 'bad' ? 'alert' : 'status'} className={cn('flex gap-3', TONE_STYLES[tone], className)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        {title && <AlertTitle className="line-clamp-none min-h-0">{title}</AlertTitle>}
        {children && <AlertDescription className={cn('block text-ink/80', title && 'mt-0.5')}>{children}</AlertDescription>}
        {action && <div className="mt-2">{action}</div>}
      </div>
    </ShAlert>
  );
}
