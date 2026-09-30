import { diffWords } from 'diff';
import { useMemo, useState } from 'react';
import { Segmented } from '@/components/ui';

/** Word-level diff of the original essay against the band+1 rewrite, with a clean-read toggle. */
export function DiffView({ original, rewrite }: { original: string; rewrite: string }) {
  const [view, setView] = useState<'diff' | 'clean'>('diff');
  const parts = useMemo(() => diffWords(original, rewrite), [original, rewrite]);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label="Rewrite view"
          size="sm"
          value={view}
          onChange={setView}
          options={[
            { value: 'diff', label: 'Show changes' },
            { value: 'clean', label: 'Clean rewrite' },
          ]}
        />
        {view === 'diff' && (
          <p className="flex items-center gap-3 text-xs text-muted">
            <span>
              <del className="rounded-sm bg-bad-soft px-1 text-bad-text">removed</del>
            </span>
            <span>
              <ins className="rounded-sm bg-good-soft px-1 text-good-text no-underline">added</ins>
            </span>
          </p>
        )}
      </div>
      <div className="prose-serif max-w-none whitespace-pre-wrap text-ink">
        {view === 'clean'
          ? rewrite
          : parts.map((p, i) =>
              p.removed ? (
                <del key={i} className="rounded-sm bg-bad-soft text-bad-text decoration-bad/60">
                  {p.value}
                </del>
              ) : p.added ? (
                <ins key={i} className="rounded-sm bg-good-soft text-good-text no-underline">
                  {p.value}
                </ins>
              ) : (
                <span key={i}>{p.value}</span>
              ),
            )}
      </div>
    </div>
  );
}
