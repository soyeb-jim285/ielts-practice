import { clsx } from 'clsx';
import { diffSentences, diffWords, type Change } from 'diff';
import { useMemo, useState } from 'react';
import { Button, Segmented } from '@/components/ui';
import { countWords } from './WritingEditor';

type Chunk = { same: string } | { parts: Change[] };

/** Sentence-level diff first (so unchanged stretches can collapse), then a word diff inside each replaced sentence. */
function chunk(original: string, rewrite: string): Chunk[] {
  const sp = diffSentences(original, rewrite);
  const out: Chunk[] = [];
  for (let i = 0; i < sp.length; i++) {
    const p = sp[i]!;
    if (p.removed && sp[i + 1]?.added) out.push({ parts: diffWords(p.value, sp[++i]!.value) });
    else out.push(p.added || p.removed ? { parts: [p] } : { same: p.value });
  }
  return out;
}

function Parts({ parts }: { parts: Change[] }) {
  return parts.map((p, i) =>
    p.removed ? (
      <del key={i} className="rounded-sm bg-bad-soft px-0.5 text-bad-text decoration-bad/60">
        {p.value}
      </del>
    ) : p.added ? (
      // A replacement (del directly followed by ins) gets a gap so "has"+"have" doesn't read "hashave".
      <ins key={i} className={clsx('rounded-sm bg-good-soft px-0.5 text-good-text no-underline', parts[i - 1]?.removed && 'ml-1')}>
        {p.value}
      </ins>
    ) : (
      <span key={i}>{p.value}</span>
    ),
  );
}

/**
 * Word-level diff of the original essay against a rewrite (band+1 or a retry), with a clean-read toggle.
 * Unchanged sentences collapse to a marker on phones (a wall of text otherwise); "Show unchanged text" brings them back.
 */
export function DiffView({ original, rewrite, cleanLabel = 'Clean rewrite' }: { original: string; rewrite: string; cleanLabel?: string }) {
  const [view, setView] = useState<'diff' | 'clean'>('diff');
  const chunks = useMemo(() => chunk(original, rewrite), [original, rewrite]);
  const changed = chunks.some((c) => 'parts' in c);
  const [full, setFull] = useState(() => globalThis.matchMedia?.('(min-width: 48rem)').matches ?? true);
  const collapse = changed && !full;
  return (
    <div className="mx-auto max-w-[68ch] space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label="Rewrite view"
          size="sm"
          value={view}
          onChange={setView}
          options={[
            { value: 'diff', label: 'Show changes' },
            { value: 'clean', label: cleanLabel },
          ]}
        />
        {view === 'diff' && (
          <p className="flex items-center gap-3 text-sm text-muted">
            <del className="rounded-sm bg-bad-soft px-1.5 text-bad-text">removed</del>
            <ins className="rounded-sm bg-good-soft px-1.5 text-good-text no-underline">added</ins>
          </p>
        )}
      </div>
      <div className="prose-serif whitespace-pre-wrap text-ink">
        {view === 'clean'
          ? rewrite
          : chunks.map((c, i) =>
              'parts' in c ? (
                <Parts key={i} parts={c.parts} />
              ) : collapse ? (
                <span key={i} className="mx-1 inline-block rounded-sm bg-surface-2 px-2 font-sans text-sm whitespace-normal text-muted">
                  {countWords(c.same)} unchanged words
                </span>
              ) : (
                <span key={i}>{c.same}</span>
              ),
            )}
      </div>
      {view === 'diff' && changed && (
        <Button variant="link" onClick={() => setFull((f) => !f)} aria-pressed={full}>
          {full ? 'Hide unchanged text' : 'Show unchanged text'}
        </Button>
      )}
    </div>
  );
}
