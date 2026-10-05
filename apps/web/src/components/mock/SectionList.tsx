import { Link } from '@tanstack/react-router';
import { BookOpen, Headphones, Mic, PenLine } from 'lucide-react';
import type { ReactNode } from 'react';
import { listStyles, RowChevron, RowIcon, rowStyles } from '@/components/bank/ListRow';
import { Badge } from '@/components/ui';
import { formatBand } from '@/lib/format';
import { isFinished, SKILL_LABEL, stateLabel, type Mock, type MockSection } from '@/lib/mock';
import { bandColor } from '@/lib/result';
import { cn } from '@/lib/utils';

const ICON = { listening: Headphones, reading: BookOpen, writing: PenLine, speaking: Mic };
const BAND_TEXT = { good: 'text-good-text', warn: 'text-warn-text', bad: 'text-bad-text' };

/** Where a finished section's normal result page lives. */
function ResultLink({ s, children }: { s: MockSection; children: ReactNode }) {
  const cls = cn(rowStyles, 'min-w-0 flex-1');
  const id = s.attemptId!;
  if (s.skill === 'listening' || s.skill === 'reading')
    return (
      <Link to="/lr/result/$attemptId" params={{ attemptId: id }} className={cls}>
        {children}
      </Link>
    );
  if (s.skill === 'writing')
    return (
      <Link to="/writing/result/$attemptId" params={{ attemptId: id }} search={{}} className={cls}>
        {children}
      </Link>
    );
  return (
    <Link to="/speaking/result/$attemptId" params={{ attemptId: id }} search={s.sessionId ? { session: s.sessionId } : {}} className={cls}>
      {children}
    </Link>
  );
}

function meta(s: MockSection) {
  if (s.state === 'in_progress' && s.elapsedS) return `${Math.floor(s.elapsedS / 60)} min used${s.limitS ? ` of ${Math.round(s.limitS / 60)}` : ''}`;
  if (s.skill === 'speaking' && s.mode && s.state !== 'skipped') return s.mode === 'live' ? 'Live examiner' : 'Recorded test';
  return null;
}

/** The four sections in order with their state, band and a link to the normal result. Used by the transition screen and the result. */
export function SectionList({ mock, target }: { mock: Pick<Mock, 'sections'>; target: number }) {
  return (
    <ul className={listStyles} aria-label="Sections">
      {mock.sections.map((s) => {
        const Icon = ICON[s.skill];
        const st = stateLabel(s);
        const linked = !!s.attemptId && isFinished(s);
        const row = (
          <>
            <RowIcon>
              <Icon />
            </RowIcon>
            <span className="min-w-0 flex-1">
              <span className="type-subheading block font-medium">{SKILL_LABEL[s.skill]}</span>
              {meta(s) && <span className="type-caption mt-0.5 block">{meta(s)}</span>}
            </span>
            <Badge tone={st.tone} className="shrink-0">
              {st.text}
            </Badge>
            <span className={cn('type-band w-10 shrink-0 text-right text-lg', s.band != null ? BAND_TEXT[bandColor(s.band, target)] : 'text-muted')}>
              {s.band != null ? (
                <>
                  <span className="sr-only">Band </span>
                  {formatBand(s.band)}
                </>
              ) : (
                <span aria-hidden>-</span>
              )}
            </span>
          </>
        );
        return (
          <li key={s.skill} className="flex items-center">
            {linked ? (
              <ResultLink s={s}>
                {row}
                <RowChevron />
              </ResultLink>
            ) : (
              <div className={cn(rowStyles, 'min-w-0 flex-1')}>{row}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
