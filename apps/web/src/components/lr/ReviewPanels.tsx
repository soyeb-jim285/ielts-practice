import { useMutation } from '@tanstack/react-query';
import { audioWindow, dictationDiff, dictationScore, TFNG_RULES, tfngValue, wordsBetween, type GapEntry, type LrTimings, type TfngPattern, type TfngRow, type LrStats } from '@ielts/core';
import { Check, ChevronRight, Ear, Plus, Play, Volume2, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Disclosure } from '@/components/result';
import { Badge, Button, Dialog, Textarea, toast } from '@/components/ui';
import { call, client } from '@/lib/api';
import { formatClock, formatDuration, plural } from '@/lib/format';
import type { LrGroup, LrQuestion, LrSection } from '@/lib/lr';
import { useAccount } from '@/lib/query';
import { cn } from '@/lib/utils';
import type { Mark } from './QuestionGroup';

const timingsOf = (s: Pick<LrSection, 'timings'>) => s.timings as LrTimings | undefined;

/** Key under which a wrong pick is explained: option letter / roman numeral as given, or TRUE / FALSE / NOT GIVEN. */
export function wrongNote(q: LrQuestion, given: string): string | undefined {
  const w = q.review?.wrong;
  if (!w || !given) return undefined;
  const g = given.trim();
  const keys = [g, g.toUpperCase(), g.toLowerCase(), tfngValue(g)].filter(Boolean);
  const hit = Object.keys(w).find((k) => keys.some((x) => x.toLowerCase() === k.toLowerCase()));
  return hit ? w[hit] : undefined;
}

export const timesText = (n: number) => (n === 1 ? 'once' : n === 2 ? '2 times' : `${n} times`);

/** A labelled run of prose in a question review: label (type-subheading h4) over body, so the label is never smaller than what it names. */
function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <h4 className="type-subheading">{title}</h4>
      {children}
    </div>
  );
}

/** Quiet in-text action: accent text, underline on hover, 44px touch target on phones. */
export function TextButton({ className, ...rest }: React.ComponentProps<'button'>) {
  return <button type="button" className={cn('type-body hit rounded-sm text-accent-text underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring', className)} {...rest} />;
}

/**
 * What went wrong and where to look, for one question. Flat (no card): the caller supplies the surrounding rule.
 * `verdict={false}` drops the "You wrote X, the answer is Y" line when the row directly above already shows that pair (Answers tab).
 */
export function QuestionDetail({ q, group, section, mark, entry, verdict = true, onClose, onShow, onPlay, onDictate }: {
  q: LrQuestion; group: LrGroup; section: LrSection; mark?: Mark; entry?: GapEntry; verdict?: boolean; onClose?: () => void; onShow?: () => void; onPlay?: () => void; onDictate?: () => void;
}) {
  const r = q.review;
  const wrong = mark && !mark.correct ? wrongNote(q, mark.given) : undefined;
  const listening = !!section.audio;
  const win = listening ? audioWindow({ timings: timingsOf(section) }, q) : null;
  const canDictate = listening && !!timingsOf(section)?.length && win?.exact && mark && !mark.correct;
  const nothing = !r && !entry && !win;
  return (
    <section id={`detail-${q.n}`} aria-label={`Question ${q.n} review`} className="type-body space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h3 className="type-subheading">Question {q.n}</h3>
          {verdict && mark && (
            <p className={cn('type-num flex items-start gap-1.5', mark.correct ? 'text-good-text' : 'text-bad-text')}>
              {mark.correct ? <Check className="mt-1 size-4 shrink-0" aria-hidden /> : <X className="mt-1 size-4 shrink-0" aria-hidden />}
              <span>{mark.correct ? 'Correct' : <>{mark.given ? <>You wrote <span className="rounded bg-bad-soft px-1">{mark.given}</span></> : 'You left it blank'}<span className="text-ink">, the answer is <span className="rounded bg-good-soft px-1 text-good-text">{mark.answer.join(' / ')}</span></span></>}</span>
            </p>
          )}
        </div>
        {onClose && <TextButton className="-mr-2 shrink-0 px-2" onClick={onClose}>Close</TextButton>}
      </div>
      {entry && (
        <div role="note" className="max-w-[68ch] space-y-1">
          <p className="flex flex-wrap items-center gap-2">
            <Badge tone="warn">{entry.label}</Badge>
            {entry.word && entry.typed && (
              <span className="type-num">
                <del className="text-bad-text">{entry.typed}</del> <span aria-hidden>→</span> <span className="sr-only">should be </span>
                <ins className="text-good-text no-underline">{entry.word}</ins>
              </span>
            )}
          </p>
          {entry.other != null && <p>This is the answer to question {entry.other}.</p>}
          <p className="text-pretty">{entry.message}</p>
          {entry.kind === 'spelling' && !!entry.before && <p className="text-warn-text">You've misspelt '{entry.word}' {timesText(entry.before)} before.</p>}
          {entry.kind === 'plural' && !!entry.before && <p className="text-warn-text">You've slipped on the ending of '{entry.word}' {timesText(entry.before)} before.</p>}
        </div>
      )}
      {r?.why && (
        <Block title="Why this is the answer">
          <p className="max-w-[68ch] text-pretty">{r.why}</p>
        </Block>
      )}
      {wrong && (
        <Block title={`Why ${mark!.given.toUpperCase().length <= 3 ? mark!.given.toUpperCase() : `"${mark!.given}"`} is not right`}>
          <p className="max-w-[68ch] text-pretty">{wrong}</p>
        </Block>
      )}
      {!!r?.paraphrase?.length && (
        <details className="group/p">
          <summary className="type-subheading flex min-h-11 cursor-pointer select-none items-center gap-1"><ChevronRight className="size-4 text-muted transition-transform group-open/p:rotate-90" aria-hidden />How the question is reworded ({r.paraphrase.length})</summary>
          <ul className="mt-1 space-y-2 pl-5">
            {r.paraphrase.map(([a, b], i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="rounded bg-surface-2 px-1.5 py-0.5">{a}</span>
                <span aria-label="means" className="text-muted">=</span>
                <span className="rounded bg-accent-soft px-1.5 py-0.5 text-accent-text">{b}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {r?.evidence && (
        <Block title={listening ? 'What the speaker says' : 'What the passage says'}>
          <blockquote className="type-reading-sm max-w-[68ch] border-l-2 border-accent pl-3 text-pretty">{r.evidence}</blockquote>
        </Block>
      )}
      {(onShow || win) && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
          {win && onPlay && (
            <Button size="sm" variant="outline" icon={<Play />} onClick={onPlay}>
              Play from {formatClock(win.from)}
            </Button>
          )}
          {onShow && <TextButton onClick={onShow}>Show {listening ? 'in transcript' : 'in passage'}</TextButton>}
          {canDictate && onDictate && <TextButton onClick={onDictate}>Dictation: type what you hear</TextButton>}
          {win && (
            <p className="type-num type-caption">
              Answer heard at {formatClock(win.start)}
              {!win.exact && ' (approx.)'}
            </p>
          )}
        </div>
      )}
      {nothing && <p className="type-caption">No extra notes for this question.</p>}
    </section>
  );
}

/** The word-by-word comparison: correct / wrong / missing / extra, each marked by text and shape as well as colour. */
export function DictationResult({ typed, expected }: { typed: string; expected: string }) {
  const ops = dictationDiff(typed, expected);
  const { right, total } = dictationScore(ops);
  return (
    <div aria-live="polite">
      <p className="type-subheading mb-2">
        {right} of {plural(total, 'word')} right
      </p>
      <p className="type-reading leading-9">
        {ops.map((o, i) => (
          <span key={i} className="mr-1.5 inline-block">
            {o.status === 'correct' && <span className="rounded px-1 text-good-text">{o.word}</span>}
            {o.status === 'wrong' && (
              <span className="rounded bg-bad-soft px-1">
                <del className="text-bad-text">{o.typed}</del> <ins className="text-good-text no-underline">{o.word}</ins>
                <span className="sr-only"> (wrong)</span>
              </span>
            )}
            {o.status === 'missing' && (
              <span className="rounded border border-dashed border-bad px-1 text-bad-text">
                {o.word}
                <span className="sr-only"> (missing)</span>
              </span>
            )}
            {o.status === 'extra' && (
              <span className="rounded bg-surface-2 px-1 text-muted line-through">
                {o.typed}
                <span className="sr-only"> (extra word)</span>
              </span>
            )}
          </span>
        ))}
      </p>
      <p className="type-caption mt-2">Dashed = you missed it, struck through = not in the recording.</p>
    </div>
  );
}

/** Plays the evidence segment and lets you type what you hear. Needs word timings. */
export function Dictation({ open, onClose, src, section, q }: { open: boolean; onClose: () => void; src: string; section: LrSection; q: LrQuestion }) {
  const win = audioWindow({ timings: timingsOf(section) }, q);
  const [typed, setTyped] = useState('');
  const [checked, setChecked] = useState(false);
  const [slow, setSlow] = useState(false);
  const el = useRef<HTMLAudioElement>(null);
  const stop = useRef<number | null>(null);
  useEffect(() => {
    if (open) {
      setTyped('');
      setChecked(false);
    }
  }, [open, q.n]);
  if (!win) return null;
  const from = Math.max(0, win.start - 0.3);
  const to = win.end + 0.4;
  const expected = wordsBetween(timingsOf(section), win.start, win.end);
  const play = () => {
    const a = el.current;
    if (!a) return;
    a.playbackRate = slow ? 0.75 : 1;
    a.currentTime = from;
    stop.current = to;
    void a.play().catch(() => {});
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Dictation"
      description={`Question ${q.n}. Play the sentence with the answer in it, as many times as you like, and type what you hear.`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button disabled={!typed.trim()} onClick={() => setChecked(true)}>
            Check
          </Button>
        </>
      }
    >
      <audio
        ref={el}
        src={src}
        preload="auto"
        onTimeUpdate={(e) => {
          if (stop.current != null && e.currentTarget.currentTime >= stop.current) {
            stop.current = null;
            e.currentTarget.pause();
          }
        }}
      />
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button icon={<Volume2 />} onClick={play}>
            Play sentence
          </Button>
          <Button variant="outline" aria-pressed={slow} onClick={() => setSlow(!slow)}>
            Slow (0.75×)
          </Button>
        </div>
        <Textarea label="What do you hear?" value={typed} rows={3} onChange={(e) => { setTyped(e.target.value); setChecked(false); }} spellCheck={false} autoCapitalize="off" autoComplete="off" />
        {checked && <DictationResult typed={typed} expected={expected} />}
      </div>
    </Dialog>
  );
}

/** Confusion table (the answer vs what you chose) per statement type, the fixed rules, and your pattern across attempts. */
export function TfngPanel({ rows, pattern }: { rows: TfngRow[]; pattern?: TfngPattern | null }) {
  const kinds = (['tfng', 'ynng'] as const).filter((k) => rows.some((r) => r.kind === k));
  if (!kinds.length) return null;
  return (
    <div className="space-y-6">
      {pattern && <p className="type-body max-w-[68ch] text-warn-text">{pattern.text} <span className="text-ink">Across all your attempts.</span></p>}
      {kinds.map((k) => {
        const vals = TFNG_RULES[k].map((r) => r.value);
        const mine = rows.filter((r) => r.kind === k);
        return (
          <div key={k} className="grid gap-x-10 gap-y-6 md:grid-cols-2">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-body">
                <caption className="type-caption mb-2 text-left">This attempt: the answer (rows) against what you chose (columns)</caption>
                <thead className="type-caption">
                  <tr className="border-b border-line">
                    <th scope="col" className="py-2 pr-3 font-normal">Answer</th>
                    {vals.map((v) => (
                      <th key={v} scope="col" className="px-2 py-2 text-center font-normal">
                        <span className="sr-only">You chose </span>
                        {v}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {vals.map((a) => (
                    <tr key={a}>
                      <th scope="row" className="type-body py-2 pr-3 text-left font-normal">{a}</th>
                      {vals.map((c) => {
                        const n = mine.filter((r) => r.answer === a && r.chose === c).length;
                        return (
                          <td key={c} className={cn('type-num px-2 py-2 text-center', a === c ? (n ? 'text-good-text' : 'text-muted') : n ? 'bg-bad-soft text-bad-text' : 'text-muted')}>
                            {n || '·'}
                            {n > 0 && a !== c && <span className="sr-only"> wrong</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <dl className="space-y-4">
              {TFNG_RULES[k].map((r) => (
                <div key={r.value} className="space-y-1">
                  <dt className="type-subheading">{r.value}</dt>
                  <dd className="type-body text-pretty">{r.rule}</dd>
                </div>
              ))}
            </dl>
          </div>
        );
      })}
    </div>
  );
}

/** Time per part against an even split, answer changes, last-minute answers and blanks. Reading is 60 minutes. */
export function PacingPanel({ stats, parts, noun, totalS, marks, blank }: {
  stats: LrStats; parts: { part: number; questions: number[] }[]; noun: string; totalS?: number; marks: Map<number, { correct: boolean }>; blank: number[];
}) {
  const times = parts.map((p) => ({ ...p, s: stats.partS[p.part] ?? 0 }));
  const spent = times.reduce((n, t) => n + t.s, 0);
  if (spent < 5 && !Object.keys(stats.changes).length) return null;
  const split = totalS ? totalS / parts.length : null;
  const max = Math.max(1, split ?? 0, ...times.map((t) => t.s));
  const changed = Object.entries(stats.changes).filter(([, n]) => n > 0).map(([n, c]) => [+n, c] as const).sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const lateWrong = stats.late.filter((n) => marks.get(n) && !marks.get(n)!.correct);
  const list = (ns: readonly number[]) => ns.slice().sort((a, b) => a - b).join(', ');
  return (
    <div>
      <div className="grid gap-x-12 gap-y-8 md:grid-cols-2">
        <div>
          <h3 className="type-subheading mb-3">Time per {noun.toLowerCase()}{split ? `, against ${formatDuration(split * 1000)} each` : ''}</h3>
          <ul className="space-y-3">
            {times.map((t) => {
              const over = split != null && t.s > split * 1.15;
              return (
                <li key={t.part}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="type-body">{noun} {t.part}</span>
                    <span className={cn('type-num type-caption', over && 'text-warn-text')}>
                      {formatDuration(t.s * 1000)}
                      {over && <span className="sr-only"> (over the suggested time)</span>}
                    </span>
                  </div>
                  <div className="relative mt-1 h-2 rounded-full bg-surface-2" role="img" aria-label={`${noun} ${t.part}: ${formatDuration(t.s * 1000)}`}>
                    <div className={cn('h-full rounded-full', over ? 'bg-warn' : 'bg-brand')} style={{ width: `${(t.s / max) * 100}%` }} />
                    {split != null && <span aria-hidden className="absolute -top-1 h-4 w-0.5 rounded-full bg-ink" style={{ left: `${(split / max) * 100}%` }} />}
                  </div>
                </li>
              );
            })}
          </ul>
          {split != null && <p className="type-caption mt-3">The marker is an even split of the 60 minutes.</p>}
        </div>
        <dl className="space-y-6">
          <div className="space-y-1">
            <dt className="type-subheading">Answers you changed</dt>
            <dd className="type-body">
              {changed.length ? (
                <>
                  <span className="type-num">{changed.reduce((n, [, c]) => n + c, 0)}</span> changes across {plural(changed.length, 'question')}
                  <span className="type-caption block">Most: {changed.slice(0, 5).map(([n, c]) => `Q${n} (${c}×)`).join(', ')}</span>
                </>
              ) : (
                'None. You stuck with your first answers.'
              )}
            </dd>
          </div>
          <div className="space-y-1">
            <dt className="type-subheading">Answered in the last 5 minutes</dt>
            <dd className="type-body">
              {stats.late.length ? (
                <>
                  <span className="type-num">{stats.late.length}</span> {stats.late.length === 1 ? 'question' : 'questions'}: {list(stats.late)}
                  {lateWrong.length > 0 && <span className="type-caption block text-warn-text">{lateWrong.length} of them wrong ({list(lateWrong)}). Rushed guesses cost marks.</span>}
                </>
              ) : (
                'None.'
              )}
            </dd>
          </div>
          <div className="space-y-1">
            <dt className="type-subheading">Left blank</dt>
            <dd className="type-body">{blank.length ? <><span className="type-num">{blank.length}</span>: {list(blank)}. There is no penalty for guessing.</> : 'None.'}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

/** Key words of a part, each with an explicit "Add to review". Guests have no deck, so they only read. */
export function VocabList({ section }: { section: LrSection }) {
  const account = useAccount();
  const [added, setAdded] = useState<Set<string>>(new Set());
  const add = useMutation({
    mutationFn: (v: { word: string; meaning: string; example?: string }) =>
      call(client.POST('/api/cards', { body: { front: v.word, back: v.example ? `${v.meaning}\n\n${v.example}` : v.meaning, source: 'vocab' } })),
    onSuccess: (_, v) => {
      setAdded((s) => new Set(s).add(v.word));
      toast('Added to your review deck', { tone: 'good' });
    },
    onError: (e) => toast(e.message, { tone: 'bad' }),
  });
  if (!section.vocab?.length) return null;
  return (
    <Disclosure title="Key vocabulary" meta={`${section.vocab.length} words`}>
      <ul className="divide-y divide-line">
        {section.vocab.map((v) => (
          <li key={v.word} className="flex items-start justify-between gap-4 py-3">
            <div className="min-w-0 max-w-[68ch] space-y-1">
              <p className="type-subheading">{v.word}</p>
              <p className="type-body text-pretty">{v.meaning}</p>
              {v.example && <p className="type-reading-sm text-pretty text-muted">{v.example}</p>}
            </div>
            {account && (
              <Button size="sm" variant="ghost" className="shrink-0 max-md:min-h-11" disabled={added.has(v.word)} loading={add.isPending && add.variables?.word === v.word} icon={added.has(v.word) ? <Check /> : <Plus />} onClick={() => add.mutate(v)}>
                {added.has(v.word) ? 'In review' : 'Add to review'}
                <span className="sr-only">: {v.word}</span>
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Disclosure>
  );
}