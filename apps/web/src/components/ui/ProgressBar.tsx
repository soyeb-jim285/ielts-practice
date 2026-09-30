import { cn } from '@/lib/utils';
import type { Tone } from './Badge';
import { Progress } from './shadcn/progress';

const FILL: Record<Tone, string> = { neutral: '[&>div]:bg-ink/40', accent: '[&>div]:bg-brand', good: '[&>div]:bg-good', warn: '[&>div]:bg-warn', bad: '[&>div]:bg-bad' };

/** Linear progress (criterion bars, uploads). `value` 0..1; `label` is the accessible name. Use ProgressRing for timers. */
export function ProgressBar({ value, tone = 'accent', label, className }: { value: number; tone?: Tone; label: string; className?: string }) {
  const v = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return <Progress value={v} aria-label={label} className={cn('[&>div]:transition-transform [&>div]:duration-300', FILL[tone], className)} />;
}
