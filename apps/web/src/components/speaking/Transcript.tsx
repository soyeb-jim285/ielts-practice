import type { AnalysisError, AnalysisResult } from '@server/ai/types';
import { clsx } from 'clsx';
import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { ErrorDetails, ErrorPopover } from '@/components/results';
import { Card, Chip, TONE_STYLES } from '@/components/ui';
import { buildTokens, DISFLUENCY, errorGroup, isLongPause, isSentenceNote, pauseSec, questionHead, type DisfluencyMark, type Token, type TranscriptFilter } from '@/lib/result';
import type { AudioControls } from './AudioBar';

const FILTERS: { value: TranscriptFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'grammar', label: 'Grammar' },
  { value: 'vocab', label: 'Vocabulary' },
  { value: 'other', label: 'Task & other' },
  { value: 'pauses', label: 'Pauses' },
  { value: 'fillers', label: 'Fillers' },
  { value: 'repeats', label: 'Repeats & repairs' },
  { value: 'unclear', label: 'Unclear' },
];

const UNCLEAR = { 1: 'decoration-warn/70', 2: 'decoration-warn', 3: 'decoration-bad' };

/** Interactive transcript: click a word to hear it, open errors, filter by issue, follow playback. */
export function Transcript({ result, audio }: { result: AnalysisResult; audio: AudioControls }) {
  const [filter, setFilter] = useState<TranscriptFilter>('all');
  const tokens = useMemo(() => buildTokens(result), [result]);
  const errors = useMemo(() => new Map(result.errors.map((e) => [e.id, e])), [result.errors]);
  const heads = useMemo(() => new Map((result.questions ?? []).flatMap((q, n) => (q.startWord >= 0 ? [[q.startWord, { n: n + 1, ...questionHead(q.text) }] as const] : []))), [result.questions]);
  const unplaced = result.errors.filter((e) => e.start < 0 || e.start >= tokens.length);

  const counts: Record<TranscriptFilter, number> = {
    all: 0,
    grammar: result.errors.filter((e) => errorGroup(e) === 'grammar').length,
    vocab: result.errors.filter((e) => errorGroup(e) === 'vocab').length,
    other: result.errors.filter((e) => errorGroup(e) === 'other').length,
    pauses: result.metrics?.pauses.length ?? 0,
    fillers: tokens.filter((t) => t.filler).length,
    repeats: tokens.reduce((n, t) => n + (t.disfluency?.length ?? 0), 0),
    unclear: tokens.filter((t) => t.unclearTier).length,
  };

  const matches = (t: Token) =>
    filter === 'all' ||
    (filter === 'fillers' && t.filler) ||
    (filter === 'repeats' && !!t.disfluency) ||
    (filter === 'unclear' && !!t.unclearTier) ||
    ((filter === 'grammar' || filter === 'vocab' || filter === 'other') && t.errorIds.some((id) => errorGroup(errors.get(id)!) === filter));

  // Sentence-wide notes (relevance etc.) would drown word-level marks, so they only show under their own filter.
  const shown = (e: AnalysisError) => !isSentenceNote(e) || filter === errorGroup(e);
  const playing = (t: Token) => audio.time >= t.start && audio.time < t.end + 0.05 && 'bg-brand-soft text-ink';
  const filler = (t: Token) => t.filler && 'text-muted line-through decoration-muted';

  const word = (t: Token) => (
    <span
      key={t.i}
      onClick={() => audio.seek(t.start)}
      title={t.unclearTier ? `Unclear to speech recognition (${Math.round((t.conf ?? 0) * 100)}% confidence)` : undefined}
      className={clsx(
        'cursor-pointer rounded-sm transition-colors duration-100 hover:bg-hover',
        playing(t),
        filler(t),
        t.unclearTier && !t.filler && !t.errorIds.some((id) => shown(errors.get(id)!)) && ['underline decoration-dotted decoration-2 underline-offset-4', UNCLEAR[t.unclearTier]],
        !matches(t) && 'opacity-35',
      )}
    >
      {t.w}
    </span>
  );

  // Typed chip before the word where the event happens. Hover (title) or tap explains it; tapping also plays that moment.
  const chips = (t: Token) =>
    t.disfluency?.map((d: DisfluencyMark, k) => (
      <button
        key={k}
        type="button"
        title={d.detail}
        aria-label={d.detail}
        onClick={() => audio.seek(d.time)}
        className={clsx(
          'mr-1 inline-flex h-5 cursor-pointer items-center rounded-sm px-1.5 align-middle font-sans text-[0.6875rem] leading-none font-medium whitespace-nowrap',
          TONE_STYLES[DISFLUENCY[d.kind].tone],
          filter !== 'all' && filter !== 'repeats' && 'opacity-35',
          filter === 'repeats' && 'ring-2',
        )}
      >
        {d.short}
      </button>
    ));

  const pause = (t: Token) => {
    const p = t.pauseAfter!;
    const long = isLongPause(p);
    if (!long && filter !== 'pauses') return null; // short pauses would break the reading flow; the Pauses filter shows them
    return (
      <span
        onClick={() => audio.seek(p.start)}
        className={clsx(
          'type-num mx-0.5 inline-flex h-6 cursor-pointer items-center gap-1 rounded-sm px-1.5 align-middle font-sans text-xs font-medium',
          long ? 'bg-bad-soft text-bad-text' : 'bg-surface-2 text-muted',
          filter !== 'all' && filter !== 'pauses' && 'opacity-35',
          filter === 'pauses' && 'ring-1 ring-current',
        )}
      >
        <span className="sr-only">pause </span>
        <span aria-hidden>pause</span>
        {pauseSec(p)}s
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
        <p key={`q${i}`} className={clsx('mb-1.5 font-sans text-sm font-medium text-muted', i > 0 && 'mt-6 border-t border-line pt-5')}>
          Q{q.n}. {q.head}
          {q.rest && <span className="mt-0.5 block font-normal">{q.rest}</span>}
        </p>,
      );
    const e = t.errorIds.map((id) => errors.get(id)!).find((x) => x.start === i && shown(x));
    if (e) {
      const span = tokens.slice(i, Math.min(e.end, tokens.length - 1) + 1);
      const last = span.at(-1)!;
      out.push(
        <Fragment key={`e${i}`}>
          {span.map((s) => (
            <Fragment key={s.i}>{chips(s)}</Fragment> // outside the popover trigger: a button cannot nest in a button
          ))}
          <ErrorPopover
            error={e}
            onPlay={() => audio.seek(t.start, last.end + 0.3)}
            className={clsx(
              'cursor-pointer rounded-sm text-left',
              isSentenceNote(e) ? 'box-decoration-clone bg-warn-soft px-0.5 hover:bg-warn-soft/70' : ['underline decoration-2 underline-offset-4 hover:bg-hover', e.severity === 'major' ? 'decoration-bad' : 'decoration-warn'],
              !matches(t) && 'opacity-35',
            )}
          >
            {span.map((s, k) => (
              <Fragment key={s.i}>
                {k > 0 && ' '}
                <span className={clsx(playing(s), filler(s))}>{s.w}</span>
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
        {chips(t)}
        {word(t)} {t.pauseAfter && <>{pause(t)} </>}
      </Fragment>,
    );
  }

  // Phones: filters, transcript, legend. lg+: the 68ch transcript on the left, filters and legend sticky on the right.
  return (
    <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,1fr)_15rem] lg:items-start lg:gap-x-10">
      <Card className="order-3 p-5 sm:p-8 lg:col-start-1 lg:row-start-1">
        <div className="type-reading leading-[2]">{out}</div>
      </Card>
      <aside className="contents lg:sticky lg:top-20 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:block lg:space-y-5">
        {/* Phones: one scrolling row; the right edge fades and the end padding lets the last chip scroll fully clear of the fade. */}
        <div role="toolbar" aria-label="Show" className="order-1 -mx-4 flex snap-x scroll-pl-4 gap-2 overflow-x-auto pr-12 pb-1 pl-4 [mask-image:linear-gradient(to_right,black_calc(100%-2.5rem),transparent)] [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0 sm:[mask-image:none] *:snap-start">
          {FILTERS.filter((f) => f.value === 'all' || f.value === filter || counts[f.value] > 0).map((f) => (
            <Chip key={f.value} selected={filter === f.value} onClick={() => setFilter(f.value)}>
              {f.label}
              {f.value !== 'all' && <span className="tabular-nums opacity-70">{counts[f.value]}</span>}
            </Chip>
          ))}
        </div>
        <Legend notes={result.errors.some(isSentenceNote)} fillers={counts.fillers > 0} marks={counts.repeats > 0} unclear={counts.unclear > 0} />
      </aside>
      {unplaced.length > 0 && <Unplaced errors={unplaced} />}
    </div>
  );
}

/** What the marks mean, above the transcript; only the marks that appear in it. */
function Legend({ notes, fillers, marks, unclear }: { notes: boolean; fillers: boolean; marks: boolean; unclear: boolean }) {
  return (
    <ul className="type-caption order-2 flex flex-wrap gap-x-5 gap-y-2 lg:flex-col">
      <li className="flex items-center gap-1.5"><span className="underline decoration-bad decoration-2 underline-offset-4">word</span> major error</li>
      <li className="flex items-center gap-1.5"><span className="underline decoration-warn decoration-2 underline-offset-4">word</span> minor error</li>
      {unclear && <li className="flex items-center gap-1.5"><span className="underline decoration-warn decoration-dotted decoration-2 underline-offset-4">word</span> unclear to speech recognition</li>}
      {fillers && <li className="flex items-center gap-1.5"><span className="text-muted line-through decoration-muted">um</span> filler</li>}
      {marks && (
        <li className="flex flex-wrap items-center gap-1.5">
          {(['repetition', 'repair', 'false_start'] as const).map((k) => (
            <span key={k} className={clsx('rounded-sm px-1.5 py-0.5 text-xs leading-none font-medium', TONE_STYLES[DISFLUENCY[k].tone])}>
              {DISFLUENCY[k].short}
            </span>
          ))}
          tap or hover for detail
        </li>
      )}
      <li className="flex items-center gap-1.5"><span className="rounded-sm bg-bad-soft px-1 text-xs font-medium whitespace-nowrap text-bad-text">pause 1.3s</span> long pause; short ones show under Pauses</li>
      {notes && <li className="flex items-center gap-1.5"><span className="rounded-sm bg-warn-soft px-1">…</span> task note (select Task &amp; other)</li>}
      <li>Tap any word to hear it</li>
    </ul>
  );
}

function Unplaced({ errors }: { errors: AnalysisError[] }) {
  return (
    <section className="order-4 lg:col-start-1">
      <h3 className="type-heading mb-3">Also noted</h3>
      <Card padded={false} className="overflow-hidden">
        <ul className="divide-y divide-line">
          {errors.map((e) => (
            <li key={e.id} className="px-5 py-4">
              <ErrorDetails error={e} />
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}
