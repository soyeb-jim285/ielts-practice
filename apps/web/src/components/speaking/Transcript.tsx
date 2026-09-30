import type { AnalysisError, AnalysisResult } from '@server/ai/types';
import { clsx } from 'clsx';
import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { ErrorDetails, ErrorPopover } from '@/components/results';
import { Chip } from '@/components/ui';
import { buildTokens, errorGroup, type Token, type TranscriptFilter } from '@/lib/result';
import type { AudioControls } from './AudioBar';

const FILTERS: { value: TranscriptFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'grammar', label: 'Grammar' },
  { value: 'vocab', label: 'Vocabulary' },
  { value: 'pauses', label: 'Pauses' },
  { value: 'fillers', label: 'Fillers' },
  { value: 'unclear', label: 'Unclear' },
];

const UNCLEAR = { 1: 'decoration-warn/70', 2: 'decoration-warn', 3: 'decoration-bad' };

/** Interactive transcript: click a word to hear it, open errors, filter by issue, follow playback. */
export function Transcript({ result, audio }: { result: AnalysisResult; audio: AudioControls }) {
  const [filter, setFilter] = useState<TranscriptFilter>('all');
  const tokens = useMemo(() => buildTokens(result), [result]);
  const errors = useMemo(() => new Map(result.errors.map((e) => [e.id, e])), [result.errors]);
  const heads = useMemo(() => new Map((result.questions ?? []).filter((q) => q.startWord >= 0).map((q, n) => [q.startWord, { n: n + 1, text: q.text }])), [result.questions]);
  const unplaced = result.errors.filter((e) => e.start < 0 || e.start >= tokens.length);

  const counts: Record<TranscriptFilter, number> = {
    all: 0,
    grammar: result.errors.filter((e) => errorGroup(e) === 'grammar').length,
    vocab: result.errors.filter((e) => errorGroup(e) === 'vocab').length,
    pauses: result.metrics?.pauses.length ?? 0,
    fillers: tokens.filter((t) => t.filler).length,
    unclear: tokens.filter((t) => t.unclearTier).length,
  };

  const matches = (t: Token) =>
    filter === 'all' ||
    (filter === 'fillers' && t.filler) ||
    (filter === 'unclear' && !!t.unclearTier) ||
    ((filter === 'grammar' || filter === 'vocab') && t.errorIds.some((id) => errorGroup(errors.get(id)!) === filter));

  const word = (t: Token) => (
    <span
      key={t.i}
      onClick={() => audio.seek(t.start)}
      title={t.unclearTier ? `Unclear to speech recognition (${Math.round((t.conf ?? 0) * 100)}% confidence)` : undefined}
      className={clsx(
        'cursor-pointer rounded-[3px] transition-colors duration-100 hover:bg-ink/6',
        audio.time >= t.start && audio.time < t.end + 0.05 && 'bg-accent-soft text-ink',
        t.filler && 'text-muted line-through decoration-muted/60',
        t.unclearTier && !t.errorIds.length && ['underline decoration-dotted decoration-2 underline-offset-4', UNCLEAR[t.unclearTier]],
        !matches(t) && 'opacity-35',
      )}
    >
      {t.w}
    </span>
  );

  const pause = (t: Token) => {
    const p = t.pauseAfter!;
    const long = p.kind === 'long';
    return (
      <span
        onClick={() => audio.seek(p.start)}
        className={clsx(
          'mx-0.5 inline-flex h-5 cursor-pointer items-center rounded-full px-1.5 align-middle font-sans text-[0.6875rem] font-medium tabular-nums',
          long ? 'bg-bad-soft text-bad-text' : 'bg-ink/6 text-muted',
          filter !== 'all' && filter !== 'pauses' && 'opacity-35',
          filter === 'pauses' && 'ring-1 ring-current',
        )}
      >
        <span aria-hidden>⏸ </span>
        <span className="sr-only">pause </span>
        {p.dur.toFixed(1)}s
      </span>
    );
  };

  // Group words into error spans (first error starting at a word wins; overlaps show in the Language tab).
  const out: ReactNode[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    const q = heads.get(i);
    if (q)
      out.push(
        <p key={`q${i}`} className={clsx('mb-1.5 font-sans text-sm font-medium text-muted', i > 0 && 'mt-5')}>
          Q{q.n}. {q.text}
        </p>,
      );
    const e = t.errorIds.map((id) => errors.get(id)!).find((x) => x.start === i);
    if (e) {
      const span = tokens.slice(i, Math.min(e.end, tokens.length - 1) + 1);
      const last = span.at(-1)!;
      out.push(
        <Fragment key={`e${i}`}>
          <ErrorPopover
            error={e}
            onPlay={() => audio.seek(t.start, last.end + 0.3)}
            className={clsx(
              'cursor-pointer rounded-[3px] text-left underline decoration-2 underline-offset-4 hover:bg-ink/6',
              e.severity === 'major' ? 'decoration-bad' : 'decoration-warn',
              !matches(t) && 'opacity-35',
            )}
          >
            {span.map((s, k) => (
              <Fragment key={s.i}>
                {k > 0 && ' '}
                <span className={clsx(audio.time >= s.start && audio.time < s.end + 0.05 && 'bg-accent-soft')}>{s.w}</span>
              </Fragment>
            ))}
          </ErrorPopover>{' '}
          {last.pauseAfter && <>{pause(last)} </>}
        </Fragment>,
      );
      i += span.length - 1;
      continue;
    }
    out.push(
      <Fragment key={i}>
        {word(t)} {t.pauseAfter && <>{pause(t)} </>}
      </Fragment>,
    );
  }

  return (
    <div className="space-y-5">
      <div role="toolbar" aria-label="Show" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0">
        {FILTERS.map((f) => (
          <Chip key={f.value} selected={filter === f.value} onClick={() => setFilter(f.value)}>
            {f.label}
            {f.value !== 'all' && <span className="tabular-nums opacity-70">{counts[f.value]}</span>}
          </Chip>
        ))}
      </div>
      <div className="prose-serif max-w-none leading-[2]">{out}</div>
      <Legend />
      {unplaced.length > 0 && <Unplaced errors={unplaced} />}
    </div>
  );
}

function Legend() {
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted">
      <li className="flex items-center gap-1.5"><span className="underline decoration-bad decoration-2 underline-offset-4">word</span> major error</li>
      <li className="flex items-center gap-1.5"><span className="underline decoration-warn decoration-2 underline-offset-4">word</span> minor error</li>
      <li className="flex items-center gap-1.5"><span className="underline decoration-warn decoration-dotted decoration-2 underline-offset-4">word</span> unclear to speech recognition</li>
      <li className="flex items-center gap-1.5"><span className="line-through">um</span> filler</li>
      <li>Tap any word to hear it</li>
    </ul>
  );
}

function Unplaced({ errors }: { errors: AnalysisError[] }) {
  return (
    <section>
      <h3 className="mb-2 text-base font-semibold">Also noted</h3>
      <ul className="divide-y divide-line rounded-card border border-line bg-surface">
        {errors.map((e) => (
          <li key={e.id} className="p-4">
            <ErrorDetails error={e} />
          </li>
        ))}
      </ul>
    </section>
  );
}
