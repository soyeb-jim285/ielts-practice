import { useNavigate } from '@tanstack/react-router';
import { clsx } from 'clsx';
import { ChevronDown, Clock, NotebookPen, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ExamShell } from '@/components/layout/ExamShell';
import { Alert, Button, Collapsible, CollapsibleContent, CollapsibleTrigger, Dialog, Tabs, toast } from '@/components/ui';
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
        'type-num inline-flex h-10 items-center gap-1.5 rounded-md px-3 text-body font-semibold transition-colors duration-200 ease-(--ease-out-expo)',
        tone === 'bad' ? 'bg-bad-soft text-bad-text' : tone === 'warn' ? 'bg-warn-soft text-warn-text' : 'bg-surface-2 text-ink',
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
  const [promptOpen, setPromptOpen] = useState(() => !drafts[prompts[0]!.id]!.text); // phones: collapse the question once the answer is under way
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
    // Editor time, split across the tasks of a full test so weekly minutes don't count it twice.
    const durationMs = Math.round(((seconds - left) * 1000) / prompts.length);
    try {
      const ids: string[] = [];
      for (const p of prompts) {
        const { text, plan } = drafts[p.id]!;
        created.current[p.id] ??= (
          await api.post<{ id: string }>('/attempts', { promptId: p.id, skill: 'writing', part: p.part, mode, sessionId: sessionId.current, parentAttemptId, text })
        ).id;
        const id = created.current[p.id]!;
        await api.post(`/attempts/${id}/submit`, { text, overtime, durationMs, ...(p.part === 2 && plan.trim() ? { plan } : {}) }).catch((e: unknown) => {
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
  const under = prompts.find((p) => countWords(drafts[p.id]!.text) < minWords(p.part));

  return (
    <ExamShell
      wide
      title={multi ? 'Writing, full test' : `Writing, ${taskLabel(current)}`}
      exit={
        <Button variant="ghost" size="sm" icon={<X />} onClick={() => setConfirm('exit')} aria-label="Exit">
          <span className="hidden sm:inline">Exit</span>
        </Button>
      }
      status={
        <>
          <TimerPill left={left} />
          <Button onClick={() => setConfirm('submit')} loading={busy}>
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
            items={prompts.map((p) => ({ value: p.id, label: `${p.part === 1 ? 'Task 1' : 'Task 2'}, ${plural(countWords(drafts[p.id]!.text), 'word')}` }))}
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
          className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:overflow-hidden"
        >
          <section aria-label="Question" className="shrink-0 border-b border-line bg-surface lg:overflow-y-auto lg:border-r lg:border-b-0">
            <button
              type="button"
              aria-expanded={promptOpen}
              aria-controls="question-body"
              onClick={() => setPromptOpen((o) => !o)}
              className="type-subheading flex h-12 w-full items-center gap-2 px-4 text-sm  focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:px-6 lg:hidden"
            >
              Question
              <span className="ml-auto flex items-center gap-1 font-normal text-muted">
                {promptOpen ? 'Hide' : 'Show'}
                <ChevronDown className={clsx('size-4 transition-transform duration-200', promptOpen && 'rotate-180')} aria-hidden />
              </span>
            </button>
            <div id="question-body" className={clsx('px-4 pt-2 pb-6 sm:px-6 lg:px-12 lg:py-10', !promptOpen && 'max-lg:hidden')}>
              <PromptPanel key={current.id} prompt={current} />
            </div>
          </section>
          <section aria-label="Answer" className="flex min-h-[70vh] flex-1 flex-col gap-3 px-4 py-4 sm:px-6 lg:min-h-0 lg:overflow-y-auto lg:px-10 lg:py-10">
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
            <Button variant={under ? 'primary' : 'ghost'} onClick={() => setConfirm(null)}>
              Keep writing
            </Button>
            <Button variant={under ? 'outline' : 'primary'} onClick={() => void submit()} loading={busy} disabled={tooShort}>
              Submit
            </Button>
          </>
        }
      >
        <ul className="divide-y divide-line rounded-lg bg-surface-2 px-4 text-sm">
          {prompts.map((p) => {
            const n = countWords(drafts[p.id]!.text);
            const min = minWords(p.part);
            return (
              <li key={p.id} className="flex items-center justify-between gap-3 py-3">
                <span className="font-medium">{taskLabel(p)}</span>
                <span className={clsx('type-num', n < min ? 'text-warn-text' : 'text-good-text')}>
                  {plural(n, 'word')}
                  {n < min && `, under ${min}`}
                </span>
              </li>
            );
          })}
        </ul>
        {tooShort ? (
          <p className="mt-3 text-sm text-muted">Write at least a paragraph{multi ? ' for each task' : ''} before submitting.</p>
        ) : (
          under && (
            <p className="mt-3 text-sm text-warn-text">
              Under {minWords(under.part)} words costs {under.part === 1 ? 'Task Achievement' : 'Task Response'} marks
              {left > 0 && `. You have ${formatClock(left)} left to add more`}.
            </p>
          )
        )}
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
            <Button variant="outline" onClick={() => void navigate({ to: '/writing' })}>
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
    <Collapsible defaultOpen={!!value} className="group/plan shrink-0 rounded-card bg-surface-2">
      <CollapsibleTrigger className="flex h-11 w-full items-center gap-2 rounded-card px-4 text-sm font-medium hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        <NotebookPen className="size-4 text-muted" aria-hidden />
        Plan <span className="font-normal text-muted">(about 5 minutes, not graded)</span>
        <ChevronDown className="ml-auto size-4 text-muted transition-transform duration-200 group-data-[state=open]/plan:rotate-180" aria-hidden />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <label className="sr-only" htmlFor="plan-pad">
          Essay plan
        </label>
        <textarea
          id="plan-pad"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={5}
          placeholder={'Position: …\nBody 1: idea + example\nBody 2: idea + example\nConclusion: …'}
          className="block w-full resize-y rounded-b-card border-t border-line bg-transparent px-4 py-3 text-body placeholder:text-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
          {...NO_ASSIST}
        />
      </CollapsibleContent>
    </Collapsible>
  );
}
