import { useBlocker, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, ArrowRight, Check, CloudOff, Flag, Headphones, LayoutGrid, LoaderCircle, Timer, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Dialog, Segmented, Sheet, Tabs, toast } from '@/components/ui';
import { useIsMobile } from '@/hooks/use-mobile';
import { formatClock, plural } from '@/lib/format';
import { flatQuestions, isAnswered, LISTENING_REVIEW_SECONDS, lsGet, lsSet, partsLabel, readingSeconds, type LrAttempt, type LrSection } from '@/lib/lr';
import { cn } from '@/lib/utils';
import { ExamAudioBar, PracticeAudio, useExamPlaylist } from './Audio';
import { Navigator, type NavPart } from './Navigator';
import { Passage, Split, useHighlights } from './Passage';
import { QuestionGroup, type Mark } from './QuestionGroup';
import { useLrSession, type SaveState } from './useLrSession';

const SAVE_TEXT: Record<SaveState, string> = { saved: 'Saved', saving: 'Saving…', dirty: 'Unsaved changes', error: 'Offline, retrying' };

export function SaveIndicator({ state }: { state: SaveState }) {
  const Icon = state === 'saved' ? Check : state === 'error' ? CloudOff : LoaderCircle;
  return (
    <span role="status" className={cn('type-caption inline-flex items-center gap-1.5', state === 'error' && 'font-medium text-warn-text')}>
      <Icon className={cn('size-3.5', state === 'saving' && 'animate-spin', state === 'saved' && 'text-good-text')} aria-hidden />
      <span className="max-sm:sr-only">{SAVE_TEXT[state]}</span>
    </span>
  );
}

function ClockPill({ seconds, countdown, label }: { seconds: number; countdown: boolean; label: string }) {
  const tone = countdown ? (seconds <= 60 ? 'bad' : seconds <= 300 ? 'warn' : 'neutral') : 'neutral';
  return (
    <div
      role="timer"
      aria-label={`${label}: ${formatClock(seconds)}`}
      className={cn(
        'type-num inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-body font-semibold',
        tone === 'bad' ? 'bg-bad-soft text-bad-text' : tone === 'warn' ? 'bg-warn-soft text-warn-text' : 'bg-surface-2 text-ink',
      )}
    >
      <Timer className="size-4" aria-hidden />
      {formatClock(seconds)}
    </div>
  );
}

/** Wall-clock seconds since the attempt began (carried over from the saved elapsed), mirrored into `out` for autosave. */
function useWallClock(base: number, running: boolean, out: { current: number }) {
  const [t, setT] = useState(base);
  const at = useRef<number | null>(null);
  useEffect(() => {
    if (!running) return;
    at.current = Date.now();
    const start = out.current;
    const i = setInterval(() => {
      const v = start + (Date.now() - at.current!) / 1000;
      out.current = v;
      setT(v);
    }, 500);
    return () => clearInterval(i);
  }, [running, out]);
  return t;
}

export function GroupsPane({ section, responses, onChange, assets, active, review }: { section: LrSection; responses: Record<string, string>; onChange: (r: Record<string, string>) => void; assets: Record<string, string>; active: number | null; review?: Map<number, Mark> }) {
  return (
    <div className="mx-auto max-w-[46rem] space-y-10 pb-16">
      {section.groups.map((g) => (
        <QuestionGroup key={g.from} group={g} responses={responses} onChange={onChange} assets={assets} active={active} review={review} />
      ))}
    </div>
  );
}

/** Scrolls a question into view and focuses its field. */
export function scrollToQuestion(n: number, focus = true) {
  const el = document.getElementById(`q-${n}`) ?? document.getElementById(`qrow-${n}`);
  if (!el) return;
  el.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  if (focus && (el instanceof HTMLInputElement || el instanceof HTMLSelectElement)) el.focus({ preventScroll: true });
}

export function Runner({ attempt }: { attempt: LrAttempt }) {
  const { test, assets } = attempt;
  const exam = attempt.mode === 'exam';
  const listening = test.skill === 'listening';
  const phone = useIsMobile();
  const navigate = useNavigate();
  const lateFrom = useRef(Infinity); // elapsed seconds after which answers count as last-minute (set once the playlist is known)
  const session = useLrSession(attempt, lateFrom);
  const { responses, change, state, submit, submitting } = session;
  const sections = test.sections; // only the chosen parts of a partial attempt
  const limit = readingSeconds(attempt.parts);
  const flat = useMemo(() => flatQuestions(test), [test]);
  const total = flat.length;
  const posKey = `lr:${attempt.id}:pos`;
  const [pos] = useState(() => lsGet<{ part: number; n: number } | null>(posKey, null));
  const [partIdx, setPartIdx] = useState(pos?.part ?? 0);
  const [current, setCurrent] = useState(pos?.n ?? flat[0]?.n ?? 1);
  const [active, setActive] = useState<number | null>(null);
  const [flagged, setFlagged] = useState<Set<number>>(() => new Set(lsGet<number[]>(`lr:${attempt.id}:flags`, [])));
  const [tab, setTab] = useState<'passage' | 'questions'>('passage');
  const [navOpen, setNavOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const leaving = useRef(false);
  const section = sections[partIdx]!;
  const hl = useHighlights(`lr:${attempt.id}:hl:${section.part}`);

  // ---- clocks ----
  const playlist = useExamPlaylist(useMemo(() => (listening ? sections.map((s) => assets[s.audio ?? ''] ?? '') : []), [listening, sections, assets]), attempt.elapsedS);
  const examListening = listening && exam;
  lateFrom.current = listening ? (exam && playlist.total ? playlist.total : Infinity) : limit - 300; // last 5 min of reading; exam listening: after the recording ends
  const wall = useWallClock(attempt.elapsedS, !examListening, session.elapsed);
  useEffect(() => {
    if (examListening && playlist.phase !== 'idle') session.elapsed.current = playlist.elapsed;
  }, [examListening, playlist.elapsed, playlist.phase, session.elapsed]);
  const started = !examListening || playlist.phase !== 'idle';
  const partNo = section.part;
  useEffect(() => {
    if (!started) return;
    const i = setInterval(() => {
      if (document.visibilityState === 'visible') session.stats.current.partS[partNo] = (session.stats.current.partS[partNo] ?? 0) + 1;
    }, 1000);
    return () => clearInterval(i);
  }, [started, partNo, session.stats]);
  const readingLeft = limit - wall;
  const timeUp = exam && (listening ? playlist.phase === 'review' && playlist.reviewLeft === 0 : readingLeft <= 0);
  const doSubmit = useCallback(async () => {
    leaving.current = true;
    try {
      await submit();
    } catch {
      leaving.current = false;
      toast('Could not submit. Your answers are saved; try again.', { tone: 'bad' });
    }
  }, [submit]);
  useEffect(() => {
    if (timeUp) void doSubmit();
  }, [timeUp, doSubmit]);
  const goPart = useCallback(
    (i: number) => {
      setPartIdx(i);
      setCurrent(sections[i]?.groups[0]?.questions[0]?.n ?? 1);
    },
    [sections],
  );
  // exam listening follows the recording
  useEffect(() => {
    if (examListening && playlist.phase === 'audio') goPart(playlist.idx);
  }, [examListening, playlist.phase, playlist.idx, goPart]);

  // ---- where you are ----
  useEffect(() => lsSet(posKey, { part: partIdx, n: current }), [posKey, partIdx, current]);
  useEffect(() => lsSet(`lr:${attempt.id}:flags`, [...flagged]), [attempt.id, flagged]);
  useEffect(() => {
    if (pos) setTimeout(() => scrollToQuestion(pos.n, false), 150); // resume where you left off
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started]);

  const jump = useCallback(
    (n: number) => {
      const f = flat.find((x) => x.n === n);
      if (!f) return;
      setPartIdx(sections.findIndex((s) => s.part === f.part));
      setCurrent(n);
      setActive(n);
      setTab('questions');
      setNavOpen(false);
      setTimeout(() => scrollToQuestion(n), 60);
      setTimeout(() => setActive((a) => (a === n ? null : a)), 2500);
    },
    [flat, sections],
  );
  const toggleFlag = () =>
    setFlagged((s) => {
      const next = new Set(s);
      if (!next.delete(current)) next.add(current);
      return next;
    });

  const navParts: NavPart[] = sections.map((s) => ({ part: s.part, label: `${listening ? 'Part' : 'Passage'} ${s.part}`, questions: s.groups.flatMap((g) => g.questions.map((q) => q.n)) }));
  const answered = (n: number) => isAnswered(responses, n);
  const unanswered = flat.filter((f) => !answered(f.n)).length;
  const idx = flat.findIndex((f) => f.n === current);
  const hub = listening ? '/listening' : '/reading';

  // ---- leaving mid-exam warns ----
  const blocker = useBlocker({ shouldBlockFn: () => exam && !leaving.current, enableBeforeUnload: () => exam && !leaving.current, withResolver: true });

  // focus tracking: which question the cursor is in
  const onFocusCapture = (e: React.FocusEvent) => {
    const q = (e.target as HTMLElement).closest<HTMLElement>('[data-q]')?.dataset.q;
    if (q) {
      setCurrent(+q);
      session.noteFocus(+q);
    }
  };
  const onBlurCapture = (e: React.FocusEvent) => {
    const q = (e.target as HTMLElement).closest<HTMLElement>('[data-q]')?.dataset.q;
    if (q) session.noteBlur(+q);
  };

  const questions = (
    <div onFocusCapture={onFocusCapture} onBlurCapture={onBlurCapture}>
      <p className="type-caption mb-5">
        {listening ? 'Part' : 'Passage'} {section.part}: Questions {section.groups[0]?.from} to {section.groups.at(-1)?.to}
      </p>
      <GroupsPane section={section} responses={responses} onChange={change} assets={assets} active={active} />
    </div>
  );
  const passage = <Passage section={section} highlights={hl.highlights.filter(Boolean)} onAdd={hl.add} onRemove={hl.remove} />;
  const hint = <p className="type-caption mt-6">Select text to highlight it. Click a highlight to remove it.</p>;

  let body;
  if (!started) {
    body = (
      <div className="mx-auto max-w-lg px-4 py-14">
        <Headphones className="mb-4 size-7 text-accent-text" aria-hidden />
        <h2 className="type-title-sm">{attempt.elapsedS > 0 ? 'Ready to continue?' : 'Ready to listen?'}</h2>
        <p className="type-lede mt-2">The recording plays once, {sections.length > 1 ? `from Part ${sections[0]!.part} to Part ${sections.at(-1)!.part}` : `Part ${sections[0]?.part} only`}, with no pause or rewind. Questions appear as you start. You get 2 minutes at the end to check your answers, then the test submits itself.</p>
        <p className="type-caption mt-3">Check your volume first. Use headphones if you can.</p>
        {playlist.error && <Alert tone="bad" className="mt-4">The recording could not be loaded. Check your connection and reload.</Alert>}
        <div className="mt-6 flex gap-2">
          <Button size="lg" loading={!playlist.durations && !playlist.error} disabled={playlist.error} onClick={playlist.start}>
            {attempt.elapsedS > 0 ? 'Resume test' : 'Start test'}
          </Button>
          <Button size="lg" variant="ghost" onClick={() => navigate({ to: hub })}>
            Back
          </Button>
        </div>
      </div>
    );
  } else if (listening) {
    body = (
      <div className="h-full overflow-y-auto px-4 py-5 sm:px-6">
        <div className="mx-auto max-w-[46rem]">
          <div className="sticky top-0 z-20 -mx-2 mb-6 rounded-lg border border-line bg-card px-4 py-3 shadow-card">
            {exam ? <ExamAudioBar playlist={playlist} parts={attempt.parts ? sections.map((s) => s.part) : undefined} /> : <PracticeAudio key={section.audio} src={assets[section.audio ?? ''] ?? ''} label={`Part ${section.part}`} resume={{ start: session.audio.start(section.part), rate: session.audio.rate, set: (p, r) => session.audio.set(section.part, p, r), save: session.audio.save }} />}
          </div>
          {questions}
        </div>
      </div>
    );
  } else if (phone) {
    body = (
      <div className="flex h-full flex-col">
        <div className="shrink-0 border-b border-line bg-surface px-4 py-2">
          <Segmented label="Show" value={tab} onChange={setTab} className="w-full" options={[{ value: 'passage', label: 'Passage' }, { value: 'questions', label: 'Questions' }]} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">{tab === 'passage' ? <>{passage}{hint}</> : questions}</div>
      </div>
    );
  } else {
    body = <Split left={<>{passage}{hint}</>} right={questions} />;
  }

  // Exam listening counts down the whole sitting (rest of the recording + the review window), as on the computer test; it was blank while the audio played.
  const clock = examListening ? (
    playlist.phase === 'review' ? (
      <ClockPill seconds={playlist.reviewLeft} countdown label="Review time left" />
    ) : playlist.total ? (
      <ClockPill seconds={Math.max(0, Math.ceil(playlist.total + LISTENING_REVIEW_SECONDS - playlist.elapsed))} countdown label="Time left" />
    ) : null
  ) : exam ? (
    <ClockPill seconds={Math.max(0, Math.ceil(readingLeft))} countdown label="Time left" />
  ) : (
    <ClockPill seconds={wall} countdown={false} label="Time spent" />
  );

  return (
    <div className="flex h-dvh flex-col bg-bg">
      {examListening && <audio ref={playlist.el} preload="auto" className="hidden" />}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface px-3 pt-[env(safe-area-inset-top)] sm:px-5">
        <Button variant="ghost" size="sm" className="-ml-1 text-muted hover:text-ink" onClick={() => navigate({ to: hub })}>
          <X aria-hidden />
          <span className="hidden sm:inline">Exit</span>
        </Button>
        <div className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight max-sm:hidden">
          {test.title}
          <span className="ml-2 font-normal text-muted">{exam ? 'Exam mode' : 'Practice mode'}{attempt.parts ? `, ${partsLabel(test.skill, attempt.parts)}` : ''}</span>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <SaveIndicator state={state} />
          {clock}
          <Button disabled={!started} onClick={() => setConfirm(true)}>
            Submit
          </Button>
        </div>
      </header>

      {started && (
        <div className="shrink-0 border-b border-line bg-surface px-3 sm:px-5">
          <Tabs
            id="lr-part"
            value={String(section.part)}
            onChange={(v) => !examListening && goPart(sections.findIndex((s) => s.part === +v))}
            items={navParts.map((p) => ({ value: String(p.part), label: p.label, count: p.questions.filter(answered).length }))}
            className="border-b-0"
          />
        </div>
      )}

      <main id="main" className="min-h-0 flex-1 overflow-hidden" key={section.part}>
        <div role="tabpanel" id="lr-part-panel" aria-labelledby={`lr-part-${section.part}`} className="h-full">
          {body}
        </div>
      </main>

      {started && (
        <footer className="shrink-0 border-t border-line bg-surface px-3 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] sm:px-5">
          {phone ? (
            <div className="flex items-center gap-2">
              <Button variant="outline" className="type-num min-w-0 flex-1 justify-start" onClick={() => setNavOpen(true)} icon={<LayoutGrid />}>
                Question {current} of {total}
                <span className="ml-auto text-muted">{total - unanswered} answered</span>
              </Button>
              <FlagButton on={flagged.has(current)} onClick={toggleFlag} compact />
              <Button variant="outline" size="icon" aria-label="Previous question" disabled={idx <= 0} onClick={() => jump(flat[idx - 1]!.n)}>
                <ArrowLeft />
              </Button>
              <Button size="icon" aria-label="Next question" disabled={idx >= total - 1} onClick={() => jump(flat[idx + 1]!.n)}>
                <ArrowRight />
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-4">
              <Navigator parts={navParts} isAnswered={answered} flagged={flagged} current={current} onJump={jump} onPart={(p) => jump(navParts.find((x) => x.part === p)!.questions[0]!)} />
              <div className="flex shrink-0 items-center gap-2">
                <FlagButton on={flagged.has(current)} onClick={toggleFlag} />
                <Button variant="outline" icon={<ArrowLeft />} disabled={idx <= 0} onClick={() => jump(flat[idx - 1]!.n)}>
                  Previous
                </Button>
                <Button disabled={idx >= total - 1} onClick={() => jump(flat[idx + 1]!.n)}>
                  Next <ArrowRight aria-hidden />
                </Button>
              </div>
            </div>
          )}
        </footer>
      )}

      <Sheet open={navOpen} onClose={() => setNavOpen(false)} title="Questions" description={`${total - unanswered} of ${total} answered${flagged.size ? `, ${flagged.size} flagged` : ''}`}>
        <Navigator variant="full" parts={navParts} isAnswered={answered} flagged={flagged} current={current} onJump={jump} />
      </Sheet>

      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Submit your answers?"
        description={
          <>
            {unanswered ? <strong className="font-semibold text-warn-text">{plural(unanswered, 'question')} unanswered.</strong> : 'Every question has an answer.'}{' '}
            {flagged.size ? `${plural(flagged.size, 'question')} flagged for review. ` : ''}You cannot change answers after submitting.
          </>
        }
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirm(false)}>
              Keep working
            </Button>
            <Button loading={submitting} onClick={doSubmit}>
              Submit answers
            </Button>
          </>
        }
      >
        {flagged.size > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label="Flagged questions">
            {[...flagged].sort((a, b) => a - b).map((n) => (
              <li key={n}>
                <Button size="sm" variant="outline" onClick={() => { setConfirm(false); jump(n); }}>
                  <Flag className="fill-warn text-warn" aria-hidden /> {n}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Dialog>

      <Dialog
        open={blocker.status === 'blocked'}
        onClose={() => blocker.reset?.()}
        title="Leave the test?"
        description="Your answers are saved. You can resume this attempt from the hub, but the exam clock does not run while you are away."
        footer={
          <>
            <Button variant="outline" onClick={() => blocker.reset?.()}>
              Stay in the test
            </Button>
            <Button variant="destructive" onClick={() => blocker.proceed?.()}>
              Leave
            </Button>
          </>
        }
      />
    </div>
  );
}

function FlagButton({ on, onClick, compact }: { on: boolean; onClick: () => void; compact?: boolean }) {
  return (
    <Button variant={on ? 'secondary' : 'outline'} size={compact ? 'icon' : undefined} aria-pressed={on} aria-label={on ? 'Remove flag from this question' : 'Flag this question for review'} onClick={onClick}>
      <Flag className={on ? 'fill-warn text-warn' : undefined} aria-hidden />
      {!compact && (on ? 'Flagged' : 'Flag')}
    </Button>
  );
}
