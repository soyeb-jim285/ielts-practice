import { useNavigate } from '@tanstack/react-router';
import { clsx } from 'clsx';
import { Clock, NotebookPen, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ExamShell } from '@/components/layout/ExamShell';
import { Alert, Button, Dialog, Tabs, toast } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { formatClock, plural } from '@/lib/format';
import { useMe } from '@/lib/query';
import { minWords, SUBMIT_FLOOR, taskLabel } from '@/lib/writing';
import { PromptPanel, type WritingPrompt } from './PromptPanel';
import { countWords, NO_ASSIST, useDrafts, WritingEditor } from './WritingEditor';

/** Seconds left on a wall-clock deadline; negative once overtime. Survives tab throttling (derived from Date.now()). */
function useDeadline(seconds: number) {
  const [deadline] = useState(() => Date.now() + seconds * 1000);
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    const t = setInterval(() => setLeft(Math.ceil((deadline - Date.now()) / 1000)), 250);
    return () => clearInterval(t);
  }, [deadline]);
  return left;
}

function TimerPill({ left }: { left: number }) {
  const tone = left <= 60 ? 'bad' : left <= 300 ? 'warn' : 'neutral';
  return (
    <div
      role="timer"
      aria-label={left < 0 ? `Overtime ${formatClock(-left)}` : `${formatClock(left)} left`}
      className={clsx(
        'inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-semibold tabular-nums transition-colors duration-200',
        tone === 'bad' ? 'bg-bad-soft text-bad-text' : tone === 'warn' ? 'bg-warn-soft text-warn-text' : 'bg-ink/6 text-ink dark:bg-ink/10',
      )}
    >
      <Clock className="size-4" aria-hidden />
      {left < 0 ? <span>+{formatClock(-left)} over</span> : formatClock(left)}
    </div>
  );
}

/**
 * The timed writing screen for one task (practice) or Task 1 + Task 2 sharing one clock (full test).
 * Owns drafts, paste policy, auto-submit/overtime and the create → submit calls; lands on the result page.
 */
export function WritingExam({
  prompts,
  seconds,
  mode,
  parentAttemptId,
}: {
  prompts: WritingPrompt[];
  seconds: number;
  mode: 'practice' | 'exam';
  parentAttemptId?: string;
}) {
  const navigate = useNavigate();
  const settings = useMe().data?.settings;
  const blockPaste = settings?.blockPaste ?? true;
  const autoSubmit = settings?.writingAutoSubmit ?? true;
  const { drafts, update, clear } = useDrafts(prompts.map((p) => p.id));
  const [active, setActive] = useState(prompts[0]!.id);
  const [confirm, setConfirm] = useState<'submit' | 'exit' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const left = useDeadline(seconds);
  const created = useRef<Record<string, string>>({}); // promptId → attemptId, so a retried submit never duplicates attempts
  const sessionId = useRef(prompts.length > 1 ? crypto.randomUUID() : undefined);
  const autoFired = useRef(false);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const overtime = left < 0;
    try {
      const ids: string[] = [];
      for (const p of prompts) {
        const { text, plan } = drafts[p.id]!;
        created.current[p.id] ??= (
          await api.post<{ id: string }>('/attempts', { promptId: p.id, skill: 'writing', part: p.part, mode, sessionId: sessionId.current, parentAttemptId, text })
        ).id;
        const id = created.current[p.id]!;
        await api.post(`/attempts/${id}/submit`, { text, overtime, ...(p.part === 2 && plan.trim() ? { plan } : {}) }).catch((e: unknown) => {
          if (!(e instanceof ApiError && e.status === 409)) throw e; // 409 = already submitted on an earlier try
        });
        ids.push(id);
      }
      clear();
      void navigate({ to: '/writing/result/$attemptId', params: { attemptId: ids[0]! }, search: ids[1] ? { pair: ids[1] } : {} });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not submit. Your answer is still here; try again.');
      setBusy(false);
      setConfirm(null);
    }
  }

  // Time's up: auto-submit once (setting), otherwise keep counting as overtime. Warn at 5 and 1 minutes.
  useEffect(() => {
    if (left === 300) toast('5 minutes left');
    if (left === 60) toast('1 minute left', { tone: 'bad' });
    if (left <= 0 && !autoSubmit) toast('Time is up. You can keep writing; the result will be marked overtime.', { tone: 'bad' });
    if (left <= 0 && autoSubmit && !autoFired.current) {
      autoFired.current = true;
      setConfirm(null);
      toast('Time is up. Submitting your answer…');
      void submit();
    }
  }, [left <= 0, left === 300, left === 60]);

  const current = prompts.find((p) => p.id === active)!;
  const draft = drafts[current.id]!;
  const multi = prompts.length > 1;
  // Manual submit needs a real attempt at every task; the time-up auto-submit still sends whatever is there.
  const tooShort = prompts.some((p) => countWords(drafts[p.id]!.text) < SUBMIT_FLOOR);

  return (
    <ExamShell
      wide
      title={multi ? 'Writing · Full test' : `Writing · ${taskLabel(current)}`}
      exit={
        <Button variant="ghost" size="sm" icon={<X />} onClick={() => setConfirm('exit')} aria-label="Exit">
          <span className="hidden sm:inline">Exit</span>
        </Button>
      }
      status={
        <>
          <TimerPill left={left} />
          <Button size="sm" onClick={() => setConfirm('submit')} loading={busy}>
            Submit
          </Button>
        </>
      }
    >
      <div className="flex h-full flex-col">
        {multi && (
          <Tabs
            id="task"
            className="shrink-0 bg-surface px-3 sm:px-5"
            value={active}
            onChange={setActive}
            items={prompts.map((p) => ({ value: p.id, label: `${p.part === 1 ? 'Task 1' : 'Task 2'} · ${plural(countWords(drafts[p.id]!.text), 'word')}` }))}
          />
        )}
        {error && (
          <Alert tone="bad" title="Submit failed" className="m-3 shrink-0 sm:mx-5">
            {error}
          </Alert>
        )}
        <div
          role={multi ? 'tabpanel' : undefined}
          id={multi ? 'task-panel' : undefined}
          aria-labelledby={multi ? `task-${active}` : undefined}
          className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:overflow-hidden"
        >
          <section aria-label="Question" className="border-line px-4 py-6 sm:px-6 lg:overflow-y-auto lg:border-r lg:px-8 lg:py-8">
            <PromptPanel key={current.id} prompt={current} />
          </section>
          <section aria-label="Answer" className="flex min-h-[60vh] flex-col gap-3 px-4 pb-6 sm:px-6 lg:min-h-0 lg:overflow-y-auto lg:px-8 lg:py-8">
            {current.part === 2 && <PlanPad value={draft.plan} onChange={(plan) => update(current.id, { plan })} />}
            <WritingEditor
              key={current.id}
              className="flex-1"
              value={draft.text}
              onChange={(text) => update(current.id, { text })}
              blockPaste={blockPaste}
              minWords={minWords(current.part)}
              label={`Your answer to ${current.part === 1 ? 'Task 1' : 'Task 2'}`}
            />
          </section>
        </div>
      </div>

      <Dialog
        open={confirm === 'submit'}
        onClose={() => setConfirm(null)}
        title={multi ? 'Submit both tasks?' : 'Submit your answer?'}
        description="You can't edit after submitting. Analysis takes about a minute."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Keep writing
            </Button>
            <Button onClick={() => void submit()} loading={busy} disabled={tooShort}>
              Submit
            </Button>
          </>
        }
      >
        <ul className="space-y-2 text-sm">
          {prompts.map((p) => {
            const n = countWords(drafts[p.id]!.text);
            const min = minWords(p.part);
            return (
              <li key={p.id} className="flex items-center justify-between gap-3 rounded-control bg-surface-2 px-3 py-2">
                <span>{taskLabel(p)}</span>
                <span className={clsx('tabular-nums', n < min ? 'text-bad-text' : 'text-good-text')}>
                  {plural(n, 'word')}
                  {n < min && ` · under ${min}`}
                </span>
              </li>
            );
          })}
        </ul>
        {tooShort && <p className="mt-3 text-sm text-muted">Write at least a paragraph{multi ? ' for each task' : ''} before submitting.</p>}
      </Dialog>

      <Dialog
        open={confirm === 'exit'}
        onClose={() => setConfirm(null)}
        title="Leave this test?"
        description="Your draft stays saved on this device. The timer restarts when you come back."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Stay
            </Button>
            <Button variant="secondary" onClick={() => void navigate({ to: '/writing' })}>
              Leave
            </Button>
          </>
        }
      />
    </ExamShell>
  );
}

function PlanPad({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <details className="group shrink-0 rounded-card border border-line bg-surface-2" open={!!value || undefined}>
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-card px-4 py-3 text-sm font-medium select-none hover:bg-ink/[0.03] [&::-webkit-details-marker]:hidden">
        <NotebookPen className="size-4 text-muted" aria-hidden />
        Plan <span className="font-normal text-muted">· about 5 minutes, not graded</span>
        <span className="ml-auto text-xs text-muted group-open:hidden">Show</span>
        <span className="ml-auto hidden text-xs text-muted group-open:inline">Hide</span>
      </summary>
      <label className="sr-only" htmlFor="plan-pad">
        Essay plan
      </label>
      <textarea
        id="plan-pad"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={5}
        placeholder={'Position: …\nBody 1: idea + example\nBody 2: idea + example\nConclusion: …'}
        className="block w-full resize-y border-t border-line bg-transparent px-4 py-3 text-[0.9375rem] outline-none placeholder:text-muted"
        {...NO_ASSIST}
      />
    </details>
  );
}
