import type { AnalysisError } from '@server/ai/types';
import { useMutation } from '@tanstack/react-query';
import { ArrowRight, BookmarkPlus, Play } from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge, Button, Popover, toast } from '@/components/ui';
import { addErrorToDeck, categoryLabel } from '@/lib/result';

/** Original → correction, explanation, and the actions. Also usable inline (Language tab lists). */
/** hideCategory: the container already titles the error with its category (e.g. a Sheet header). */
export function ErrorDetails({ error, onPlay, onDone, hideCategory }: { error: AnalysisError; onPlay?: () => void; onDone?: () => void; hideCategory?: boolean }) {
  const add = useMutation({
    mutationFn: () => addErrorToDeck(error),
    onSuccess: () => {
      toast('Added to review deck', { tone: 'good' });
      onDone?.();
    },
    onError: (e) => toast(e.message, { tone: 'bad' }),
  });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={error.severity === 'major' ? 'bad' : 'warn'}>{error.severity}</Badge>
        {!hideCategory && <span className="type-caption">{categoryLabel(error.category)}</span>}
      </div>
      {(error.original || error.correction) && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 type-reading-sm">
          <span className="text-muted line-through decoration-bad/60">{error.original}</span>
          <ArrowRight role="img" className="size-4 text-muted" aria-label="should be" />
          <span className="font-medium text-good-text">{error.correction}</span>
        </p>
      )}
      <p className="text-sm leading-relaxed text-ink/85">{error.explanation}</p>
      <div className="flex flex-wrap gap-2">
        {onPlay && (
          <Button size="sm" variant="outline" icon={<Play />} onClick={onPlay}>
            Play this bit
          </Button>
        )}
        <Button size="sm" variant="ghost" icon={<BookmarkPlus />} loading={add.isPending} disabled={add.isSuccess} onClick={() => add.mutate()}>
          {add.isSuccess ? 'In your deck' : 'Add to review deck'}
        </Button>
      </div>
    </div>
  );
}

/**
 * An error span in a transcript/essay that opens its explanation.
 * Props: error, children (the highlighted words), onPlay (seek + play the span; omit for writing), className (underline styles).
 */
export function ErrorPopover({ error, children, onPlay, className }: { error: AnalysisError; children: ReactNode; onPlay?: () => void; className?: string }) {
  return (
    <Popover
      trigger={(p) => (
        <button {...p} type="button" aria-label={`${categoryLabel(error.category)} error: ${error.original}`} className={className}>
          {children}
        </button>
      )}
    >
      {(close) => (
        <ErrorDetails
          error={error}
          onPlay={
            onPlay &&
            (() => {
              onPlay();
              close();
            })
          }
        />
      )}
    </Popover>
  );
}
