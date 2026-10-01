import { formMatcher, type RepeatedWord } from '@ielts/core';
import { X } from 'lucide-react';
import { Chip } from '@/components/ui';
import { Fragment, type ReactNode } from 'react';

/** Neutral tint for "every use of the word you leaned on": distinct from the error underlines and the teal "playing now". */
export const LEAN_CLASS = 'rounded-sm bg-ink/15 box-decoration-clone';

/** Wraps each matching word of `text` in a highlighted <mark>; other text passes through. */
export function highlightWords(text: string, lean: RepeatedWord | null | undefined): ReactNode {
  if (!lean) return text;
  const match = formMatcher(lean);
  return text.split(/([A-Za-z]+(?:'[A-Za-z]+)?)/).map((p, i) => (i % 2 && match(p) ? <mark key={i} data-lean className={`${LEAN_CLASS} text-ink`}>{p}</mark> : <Fragment key={i}>{p}</Fragment>));
}

/** "Highlighting: work ×6" above the text, with a clear button. */
export function LeanPill({ lean, onClear }: { lean: RepeatedWord; onClear: () => void }) {
  return (
    <p className="inline-flex items-center gap-2 rounded-sm bg-ink/10 py-1 pr-1 pl-3 text-sm text-ink">
      <span>Highlighting: <strong className="font-semibold">{lean.word}</strong> <span className="type-num">×{lean.count}</span>{lean.forms && lean.forms.length > 1 && <span className="text-muted"> ({lean.forms.join(', ')})</span>}</span>
      <button type="button" onClick={onClear} aria-label="Clear highlight" className="grid size-6 place-items-center rounded-sm hover:bg-hover focus-visible:outline-2 focus-visible:outline-ring">
        <X className="size-4" aria-hidden />
      </button>
    </p>
  );
}

/** A "Words you leaned on" chip: a toggle that highlights every use of the word's forms in the text. */
export function LeanChip({ r, lean, onLean }: { r: RepeatedWord; lean?: RepeatedWord | null; onLean?: (w: RepeatedWord | null) => void }) {
  const on = lean?.word === r.word;
  return (
    <Chip
      selected={on}
      disabled={!onLean}
      onClick={() => onLean?.(on ? null : r)}
      title={r.forms && r.forms.length > 1 ? r.forms.join(', ') : undefined}
      className="h-7 gap-1.5 px-3 text-sm data-[state=on]:border-ink/30 data-[state=on]:bg-ink/15 data-[state=on]:text-ink data-[state=on]:hover:text-ink max-md:h-9"
    >
      <span className="text-ink">{r.word}</span> <span className="type-num text-xs">×{r.count}</span>
    </Chip>
  );
}
