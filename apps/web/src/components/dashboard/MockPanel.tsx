import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowRight, Check, Circle, CircleDot } from 'lucide-react';
import { Section } from '@/components/result';
import { useCurrentMock } from '@/components/mock/useMock';
import { buttonStyles } from '@/components/ui';
import { formatBand, formatDate } from '@/lib/format';
import { isFinished, mockListQuery, SKILL_LABEL, SKILLS, type Mock } from '@/lib/mock';
import { cn } from '@/lib/utils';

type Step = 'done' | 'next' | 'todo';
const DURATION = { listening: '30 min plus review', reading: '60 min', writing: '60 min', speaking: '11-14 min' } as const;
const STEP_TEXT: Record<Step, string> = { done: 'Done', next: 'Next', todo: 'To do' };

/** Four steps in sitting order. State is an icon plus a word, never colour alone. */
export function MockSteps({ mock }: { mock?: Mock | null }) {
  return (
    <ol className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
      {SKILLS.map((k) => {
        const s = mock?.sections.find((x) => x.skill === k);
        const step: Step = !mock ? 'todo' : s && isFinished(s) ? 'done' : mock.next === k ? 'next' : 'todo';
        const Icon = step === 'done' ? Check : step === 'next' ? CircleDot : Circle;
        return (
          <li key={k} className="min-w-0">
            <p className={cn('type-subheading flex items-center gap-2', step === 'next' && 'text-accent-text')}>
              <Icon className="size-4 shrink-0" aria-hidden />
              {SKILL_LABEL[k]}
              {mock && <span className="type-caption font-normal">{STEP_TEXT[step]}</span>}
            </p>
            <p className="type-caption mt-1 pl-6">{DURATION[k]}</p>
          </li>
        );
      })}
    </ol>
  );
}

/** The mock test as a flat panel: what it is, the four steps, one outline button. Replaces the card on top and the first row of Practise.
 *  `continuedAbove`: Next up already offers "Continue your mock test", so an open mock shows only its steps here (no second sentence and button). */
export function MockPanel({ continuedAbove = false }: { continuedAbove?: boolean }) {
  const open = useCurrentMock().data;
  const list = useQuery(mockListQuery);
  const last = list.data?.find((m) => m.overall != null);
  const to = open ? ({ to: '/mock/$id', params: { id: open.id } } as const) : ({ to: '/mock' } as const);
  return (
    <Section title="Full mock test" id="mock">
      {!(open && continuedAbove) && <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
        <p className="type-body max-w-[68ch]">
          {open ? `Continue: ${open.next ? `${SKILL_LABEL[open.next]} next` : 'open'}. Pick up where you stopped.` : 'Listening, Reading, Writing and Speaking in one sitting, with an overall band.'}
        </p>
        <Link {...to} className={buttonStyles({ variant: 'outline', className: 'shrink-0 max-sm:w-full' })}>
          {open ? 'Continue' : 'Start a mock test'} <ArrowRight aria-hidden />
        </Link>
      </div>}
      <MockSteps mock={open} />
      {last && (
        <p className="type-caption type-num">
          Last mock:{' '}
          <Link to="/mock/$id" params={{ id: last.id }} className="font-medium text-accent-text underline underline-offset-4 hover:no-underline">
            {formatBand(last.overall)} on {formatDate(last.completedAt ?? last.startedAt)}
          </Link>
        </p>
      )}
    </Section>
  );
}
