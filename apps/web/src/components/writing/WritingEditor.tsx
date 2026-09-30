import { countWords } from '@ielts/core';
import { clsx } from 'clsx';
import { useCallback, useEffect, useId, useRef, useState, type ClipboardEvent, type DragEvent } from 'react';
import { toast } from '@/components/ui';
import { plural } from '@/lib/format';

/** Words as IELTS examiners count them. */
export { countWords }; // core rule, same as the server scores with (numbers and "75%" count, bare punctuation does not)

/** Kills autocorrect / spellcheck / Grammarly (Global Constraints). Spread onto every writing input. */
export const NO_ASSIST = {
  spellCheck: false,
  autoCorrect: 'off',
  autoCapitalize: 'off',
  autoComplete: 'off',
  'data-gramm': 'false',
  'data-gramm_editor': 'false',
  'data-enable-grammarly': 'false',
} as const;

export type Draft = { text: string; plan: string };
const EMPTY: Draft = { text: '', plan: '' };
const draftKey = (promptId: string) => `draft:${promptId}`;

function readDraft(promptId: string): Draft {
  try {
    const raw = localStorage.getItem(draftKey(promptId));
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as Partial<Draft>) } : EMPTY;
  } catch {
    return EMPTY;
  }
}

/**
 * Essay + plan per prompt, autosaved to localStorage (`draft:{promptId}`) every 5 s and when the tab hides.
 * `clear()` after a successful submit. `promptIds` must not change for the component's lifetime.
 */
export function useDrafts(promptIds: string[]) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => Object.fromEntries(promptIds.map((id) => [id, readDraft(id)])));
  const latest = useRef(drafts);
  latest.current = drafts;
  const saved = useRef<Record<string, string>>({});
  const done = useRef(false);

  const save = useCallback(() => {
    if (done.current) return;
    for (const [id, d] of Object.entries(latest.current)) {
      const json = JSON.stringify(d);
      if (json === (saved.current[id] ?? JSON.stringify(EMPTY))) continue;
      try {
        localStorage.setItem(draftKey(id), json);
        saved.current[id] = json;
      } catch {
        // ponytail: storage full / private mode — the essay still lives in memory until submit.
      }
    }
  }, []);

  useEffect(() => {
    const t = setInterval(save, 5000);
    const onHide = () => document.visibilityState === 'hidden' && save();
    document.addEventListener('visibilitychange', onHide);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onHide);
      save();
    };
  }, [save]);

  const update = useCallback((id: string, patch: Partial<Draft>) => setDrafts((d) => ({ ...d, [id]: { ...(d[id] ?? EMPTY), ...patch } })), []);

  const clear = useCallback(() => {
    done.current = true; // submitted: never write this draft back
    for (const id of Object.keys(latest.current)) {
      try {
        localStorage.removeItem(draftKey(id));
      } catch {
        /* nothing to clear */
      }
    }
  }, []);

  return { drafts, update, clear };
}

/** The answer box: no autocorrect, optional paste blocking, live word count against the task minimum. */
export function WritingEditor({
  value,
  onChange,
  blockPaste,
  minWords,
  label = 'Your answer',
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  blockPaste: boolean;
  minWords: number;
  label?: string;
  className?: string;
}) {
  const id = useId();
  const words = countWords(value);
  const under = words < minWords;
  const block = (e: ClipboardEvent | DragEvent) => {
    if (!blockPaste) return;
    e.preventDefault();
    toast('Pasting is disabled in exam mode', { tone: 'bad' });
  };

  return (
    <div className={clsx('flex min-h-0 flex-col rounded-card border border-line bg-surface shadow-card focus-within:border-line-strong', className)}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onPaste={block}
        onDrop={block}
        placeholder="Start writing…"
        aria-describedby={`${id}-count`}
        className="prose-serif min-h-[18rem] w-full max-w-none flex-1 resize-none bg-transparent px-5 py-4 text-ink outline-none placeholder:text-muted"
        {...NO_ASSIST}
      />
      <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-2.5 text-sm">
        <span
          id={`${id}-count`}
          aria-live="polite"
          className={clsx('font-medium tabular-nums', !under ? 'text-good-text' : words >= minWords * 0.9 ? 'text-warn-text' : 'text-muted')}
        >
          {plural(words, 'word')}
        </span>
        <span className="text-muted tabular-nums">{under ? `${minWords - words} to go · min ${minWords}` : `Minimum ${minWords} reached`}</span>
      </div>
    </div>
  );
}
