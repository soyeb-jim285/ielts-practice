import { Flag } from 'lucide-react';
import { cn } from '@/lib/utils';

export type NavPart = { part: number; label: string; questions: number[] };

/** Question number button: filled teal = answered, amber flag = marked for review, ring = where you are. */
export function QButton({ n, answered, flagged, current, onJump, className }: { n: number; answered: boolean; flagged: boolean; current: boolean; onJump: (n: number) => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={() => onJump(n)}
      aria-current={current ? 'step' : undefined}
      aria-label={`Question ${n}, ${answered ? 'answered' : 'not answered'}${flagged ? ', flagged for review' : ''}`}
      className={cn(
        'type-num relative grid size-8 shrink-0 place-items-center rounded-md border text-sm font-medium transition-colors duration-[120ms] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring max-md:size-10',
        answered ? 'border-brand/30 bg-accent-soft text-accent-text' : 'border-line bg-card text-muted hover:border-input hover:text-ink',
        current && 'border-brand ring-2 ring-brand',
        className,
      )}
    >
      {n}
      {flagged && <Flag aria-hidden className="absolute -top-1.5 -right-1.5 size-3.5 fill-warn text-warn" />}
    </button>
  );
}

/**
 * Question navigator 1-40 grouped by part. `bar` (desktop footer) opens the current part and folds the others to "Part 2 · 4/10" chips that switch part;
 * `full` (mobile sheet) lists every part open.
 */
export function Navigator({
  parts,
  isAnswered,
  flagged,
  current,
  onJump,
  onPart,
  variant = 'bar',
}: {
  parts: NavPart[];
  isAnswered: (n: number) => boolean;
  flagged: Set<number>;
  current: number;
  onJump: (n: number) => void;
  onPart?: (part: number) => void;
  variant?: 'bar' | 'full';
}) {
  const currentPart = parts.find((p) => p.questions.includes(current))?.part ?? parts[0]?.part;
  return (
    <nav aria-label="Question navigator" className={cn(variant === 'bar' ? 'flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2' : 'space-y-5')}>
      {parts.map((p) => {
        const done = p.questions.filter(isAnswered).length;
        const open = variant === 'full' || p.part === currentPart;
        if (!open)
          return (
            <button
              key={p.part}
              type="button"
              onClick={() => onPart?.(p.part)}
              className="type-num inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-card px-2.5 text-sm text-muted hover:border-input hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              aria-label={`${p.label}, ${done} of ${p.questions.length} answered`}
            >
              <span className="font-medium text-ink">{p.label}</span>
              {done}/{p.questions.length}
            </button>
          );
        return (
          <div key={p.part} className={cn(variant === 'bar' ? 'flex items-center gap-2' : 'space-y-2')} role="group" aria-label={p.label}>
            <p className={cn('type-caption', variant === 'bar' && 'pr-1')}>
              <span className="font-medium text-ink">{p.label}</span>
              <span className="type-num ml-2">{done} of {p.questions.length} answered</span>
            </p>
            <div className="flex flex-wrap gap-1.5">
              {p.questions.map((n) => (
                <QButton key={n} n={n} answered={isAnswered(n)} flagged={flagged.has(n)} current={n === current} onJump={onJump} />
              ))}
            </div>
          </div>
        );
      })}
    </nav>
  );
}
