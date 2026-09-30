import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import type { Tone } from './Badge';
import { Progress } from './shadcn/progress';

const FILL: Record<Tone, string> = { neutral: '[&>div]:bg-muted', accent: '[&>div]:bg-brand', info: '[&>div]:bg-sky', good: '[&>div]:bg-good', warn: '[&>div]:bg-warn', bad: '[&>div]:bg-bad' };

/** Linear progress (criterion bars, uploads). `value` 0..1; `label` is the accessible name. Use ProgressRing for timers. */
export function ProgressBar({ value, tone = 'accent', label, className }: { value: number; tone?: Tone; label: string; className?: string }) {
  const v = Math.round(Math.min(1, Math.max(0, value)) * 100);
  // Mount at 0, then fill on the next frame so the bar animates in (transition lives on the indicator).
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(v));
    return () => cancelAnimationFrame(id);
  }, [v]);
  return <Progress value={shown} aria-label={label} className={cn(FILL[tone], className)} />;
}
