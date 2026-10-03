import { activeAt, formMatcher, type RepeatedWord } from '@ielts/core';
import type { AnalysisError, AnalysisResult } from '@server/ai/types';
import { clsx } from 'clsx';
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { LEAN_CLASS, LeanPill } from '@/components/LeanPill';
import { ErrorDetails, ErrorPopover } from '@/components/results';
import { Card, Chip } from '@/components/ui';
import { buildTokens, errorGroup, errorType, isLongPause, isSentenceNote, pauseSec, questionHead, type DisfluencyMark, type Token, type TranscriptFilter } from '@/lib/result';
import { timelineMarkers, wordAt, type MarkerType } from '@/lib/timeline';
import type { AudioControls } from './AudioBar';
import { MarkerDetail, MarkerShape, TYPE_STYLE } from './timeline';

const FILTERS: { value: TranscriptFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'grammar', label: 'Grammar' },
  { value: 'vocab', label: 'Vocabulary' },
  { value: 'pronunciation', label: 'Pronunciation' },
  { value: 'fluency', label: 'Fluency' },
  { value: 'other', label: 'Task & other' },
  { value: 'pauses', label: 'Pauses' },
];
const FILTER_TYPE: Partial<Record<TranscriptFilter, MarkerType>> = { grammar: 'grammar', vocab: 'vocabulary', pronunciation: 'pronunciation', fluency: 'fluency' };

// Karaoke: the playing word gets this teal tint (set on the DOM directly, so a 10 Hz clock never re-renders the words).
const NOW = ['bg-brand-soft', 'text-ink'];
const NOW_PAUSE = ['ring-2', 'ring-brand'];
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Interactive transcript: click a word to hear it, open errors, filter by issue, follow playback. */
export function Transcript({ result, audio, lean, onClear }: { result: AnalysisResult; audio: AudioControls; lean?: RepeatedWord | null; onClear?: () => void }) {
  const [filter, setFilter] = useState<TranscriptFilter>('all');
  const tokens = useMemo(() => buildTokens(result), [result]);
  const errors = useMemo(() => new Map(result.errors.map((e) => [e.id, e])), [result.errors]);
  const heads = useMemo(() => new Map((result.questions ?? []).flatMap((q, n) => (q.startWord >= 0 ? [[q.startWord, { n: n + 1, ...questionHead(q.text) }] as const] : []))), [result.questions]);
  const unplaced = result.errors.filter((e) => e.start < 0 || e.start >= tokens.length);
  const timeline = useMemo(() => timelineMarkers(result), [result]);
  const root = useRef<HTMLDivElement>(null);
  const { focus } = audio;
  const isLean = useMemo(() => (lean ? formMatcher(lean) : () => false), [lean]);
  const marker = timeline.markers.find((m) => m.id === focus);

  const counts: Record<TranscriptFilter, number> = {
    all: 0,
    grammar: 0,
    vocab: 0,
    pronunciation: 0,
    fluency: 0,
    other: result.errors.filter((e) => errorGroup(e) === 'other').length,
    pauses: result.metrics?.pauses.length ?? 0,
  };
  for (const m of timeline.markers) counts[m.type === 'vocabulary' ? 'vocab' : m.type]++;
  const hasFillers = tokens.some((t) => t.filler || t.disfluency?.some((d) => d.kind === 'filled'));
  const hasMarks = tokens.some((t) => t.disfluency);
  const hasUnclear = tokens.some((t) => t.unclearTier);

  const matches = (t: Token) =>
    filter === 'all' ||
    (filter === 'pronunciation' && !!t.unclearTier) ||
    (filter === 'fluency' && (!!t.filler || !!t.disfluency)) ||
    (filter !== 'pauses' && t.errorIds.some((id) => errorGroup(errors.get(id)!) === filter));

  // Karaoke highlight: toggle classes on the playing word, or on the pause chip while a pause plays. Driven by the audio element's exact clock
  // (frame loop while playing, once when paused or seeked), not the 0.1 s display time, so words flash in step with the voice.
  const now = useRef<Element[]>([]);
  useEffect(() => {
    let raf = 0;
    let last = '';
    const paint = () => {
      const a = activeAt(tokens, audio.now());
      const key = `${a.word}:${a.pause}`;
      if (key === last) return;
      last = key;
      const el = a.word < 0 ? null : root.current?.querySelector(a.pause ? `[data-p="${a.word}"]` : `[data-w="${a.word}"]`);
      now.current.forEach((e) => e.classList.remove(...NOW, ...NOW_PAUSE));
      now.current = el ? [el] : [];
      el?.classList.add(...(a.pause ? NOW_PAUSE : NOW));
    };
    const loop = () => {
      paint();
      raf = requestAnimationFrame(loop);
    };
    if (audio.playing) loop();
    else paint();
    return () => cancelAnimationFrame(raf);
  }, [audio.playing, audio.playing ? -1 : audio.time, audio.now, tokens, filter]);

  // A mistake picked elsewhere (chart, audio bar): bring its word into view.
  useEffect(() => {
    const m = timeline.markers.find((x) => x.id === focus);
    if (m) root.current?.querySelector(`[data-w="${Math.max(wordAt(tokens, m.t), 0)}"]`)?.scrollIntoView({ block: 'center', behavior: reduceMotion() ? 'auto' : 'smooth' });
  }, [focus, timeline, tokens]);

  // Sentence-wide notes (relevance etc.) would drown word-level marks, so they only show under their own filter.
  const shown = (e: AnalysisError) => !isSentenceNote(e) || filter === errorGroup(e);
  // Fillers stay in the text, marked like the other fluency issues.
  const filler = (t: Token) => t.filler && ['underline decoration-2 underline-offset-4', TYPE_STYLE.fluency.underline];

  const word = (t: Token) => (
    <span
      key={t.i}
      data-w={t.i}
      data-lean={isLean(t.w) || undefined}
      onClick={() => audio.seek(t.start)}
      title={t.unclearTier ? `Unclear to speech recognition (${Math.round((t.conf ?? 0) * 100)}% confidence)` : undefined}
      className={clsx(
        'cursor-pointer rounded-sm transition-colors duration-100 hover:bg-hover',
        filler(t),
        isLean(t.w) && LEAN_CLASS,
        t.unclearTier && !t.filler && !t.errorIds.some((id) => shown(errors.get(id)!)) && ['underline decoration-2 underline-offset-4', TYPE_STYLE.pronunciation.underline],
        !matches(t) && 'opacity-35',
      )}
    >
      {t.w}
    </span>
  );

  // Typed chip before the word where the event happens. Hover (title) or tap explains it; tapping also plays that moment.
  const chips = (t: Token) =>
    t.disfluency?.map((d: DisfluencyMark, k) =>
      // A filled pause the recogniser dropped: typed out where it was heard instead of a tag.
      d.kind === 'filled' ? (
        <Fragment key={k}>
          <button
            type="button"
            title={d.detail}
            aria-label={d.detail}
            onClick={() => audio.seek(d.time)}
            className={clsx('cursor-pointer rounded-sm italic hover:bg-hover', ['underline decoration-2 underline-offset-4', TYPE_STYLE.fluency.underline], filter !== 'all' && filter !== 'fluency' && 'opacity-35')}
          >
            um
          </button>{' '}
        </Fragment>
      ) : (
      <button
        key={k}
        type="button"
        title={d.detail}
        aria-label={d.detail}
        onClick={() => audio.seek(d.time)}
        className={clsx(
          'mr-1 inline-flex h-5 cursor-pointer items-center gap-1 rounded-sm bg-surface-2 px-1.5 align-middle font-sans text-[0.6875rem] leading-none font-medium whitespace-nowrap text-muted',
          filter !== 'all' && filter !== 'fluency' && 'opacity-35',
          filter === 'fluency' && 'ring-1 ring-chart-3',
        )}
      >
        <MarkerShape type="fluency" size={8} />
        {d.short}
      </button>
      ),
    );

  const pause = (t: Token) => {
    const p = t.pauseAfter!;
    const long = isLongPause(p);
    if (!long && filter !== 'pauses') return null; // short pauses would break the reading flow; the Pauses filter shows them
    return (
      <span
        data-p={t.i}
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
  // Memoised: the playback clock ticks 10×/s, and the words must not re-render with it.
  const out = useMemo(() => {
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
              isSentenceNote(e) ? 'box-decoration-clone bg-warn-soft px-0.5 hover:bg-warn-soft/70' : ['underline decoration-2 underline-offset-4 hover:bg-hover', TYPE_STYLE[errorType(e.category) ?? 'fluency'].underline, !errorType(e.category) && 'decoration-muted'],
              !matches(t) && 'opacity-35',
            )}
          >
            {span.map((s, k) => (
              <Fragment key={s.i}>
                {k > 0 && ' '}
                <span data-w={s.i} data-lean={isLean(s.w) || undefined} className={clsx(filler(s), isLean(s.w) && LEAN_CLASS) || undefined}>{s.w}</span>
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

  return out;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- word/chips/pause are rebuilt from exactly these
  }, [tokens, filter, errors, heads, audio.seek, isLean]);

  // Bring the first highlighted use into view when a word is picked.
  useEffect(() => {
    if (lean) root.current?.querySelector('[data-lean]')?.scrollIntoView({ block: 'center', behavior: reduceMotion() ? 'auto' : 'smooth' });
  }, [lean]);

  // Phones: filters, transcript, legend. lg+: the 68ch transcript on the left, filters and legend sticky on the right.
  return (
    <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,1fr)_15rem] lg:items-start lg:gap-x-10">
      <div className="order-3 space-y-5 lg:col-start-1 lg:row-start-1">
        {lean && onClear && <LeanPill lean={lean} onClear={onClear} />}
        {marker && <MarkerDetail marker={marker} audio={audio} />}
        <Card className="p-5 sm:p-8">
          <div ref={root} className="type-reading leading-[2]">{out}</div>
        </Card>
      </div>
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
        <Legend notes={result.errors.some(isSentenceNote)} fillers={hasFillers} marks={hasMarks} unclear={hasUnclear} />
      </aside>
      {unplaced.length > 0 && <Unplaced errors={unplaced} />}
    </div>
  );
}

/** What the marks mean, above the transcript; only the marks that appear in it. */
function Legend({ notes, fillers, marks, unclear }: { notes: boolean; fillers: boolean; marks: boolean; unclear: boolean }) {
  const shown: Record<MarkerType, boolean> = { grammar: true, vocabulary: true, pronunciation: unclear, fluency: fillers || marks };
  return (
    <ul className="type-caption order-2 flex flex-wrap gap-x-5 gap-y-2 lg:flex-col">
      {(Object.keys(TYPE_STYLE) as MarkerType[]).filter((k) => shown[k]).map((k) => (
        <li key={k} className="flex items-center gap-1.5">
          <MarkerShape type={k} size={9} />
          <span className={clsx('underline decoration-2 underline-offset-4', TYPE_STYLE[k].underline)}>word</span> {TYPE_STYLE[k].label.toLowerCase()}
        </li>
      ))}
      {fillers && <li className="flex items-center gap-1.5"><span className={clsx('underline decoration-2 underline-offset-4', TYPE_STYLE.fluency.underline)}>um</span> filler (italic when only heard in the audio)</li>}
      {marks && <li>Tap a grey tag for the detail</li>}
      <li className="flex items-center gap-1.5"><span className="rounded-sm bg-bad-soft px-1 text-xs font-medium whitespace-nowrap text-bad-text">pause 1.3s</span> long pause; short ones show under Pauses</li>
      {notes && <li className="flex items-center gap-1.5"><span className="rounded-sm bg-warn-soft px-1">…</span> task note (select Task &amp; other)</li>}
      <li className="flex items-center gap-1.5"><span className="rounded-sm bg-brand-soft px-1 text-ink">word</span> playing now; tap any word to hear it</li>
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
