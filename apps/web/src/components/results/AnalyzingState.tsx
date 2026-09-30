import { Check, LoaderCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui';

/**
 * Shown while an attempt is `analyzing` (the page polls). Steps advance on an estimated schedule since
 * the server reports no per-step progress. Props: steps (labels in order), stepSeconds (estimate per step, default 8), title.
 */
export function AnalyzingState({ steps, stepSeconds = 8, title = 'Analysing your answer' }: { steps: string[]; stepSeconds?: number; title?: string }) {
  const [t, setT] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setT((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const active = Math.min(steps.length - 1, Math.floor(t / stepSeconds));
  return (
    <Card className="max-w-lg" aria-busy>
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground" aria-live="polite">
        {t >= 45 ? "Taking longer than usual — you can leave; we'll keep working and the result will be in your history." : 'Usually under a minute. You can leave this page — the result will be in your history.'}
      </p>
      <ol className="mt-5 space-y-3" aria-live="polite">
        {steps.map((s, i) => (
          <li key={s} className={`flex items-center gap-3 text-[0.9375rem] ${i > active ? 'text-muted-foreground' : ''}`} aria-current={i === active ? 'step' : undefined}>
            <span className={`grid size-6 place-items-center rounded-full ${i < active ? 'bg-good-soft text-good-text' : i === active ? 'bg-brand-soft text-brand-text' : 'bg-surface-2'}`}>
              {i < active ? <Check className="size-3.5" aria-label="done" /> : i === active ? <LoaderCircle className="size-3.5 animate-spin" aria-label="in progress" /> : null}
            </span>
            {s}
          </li>
        ))}
      </ol>
    </Card>
  );
}
