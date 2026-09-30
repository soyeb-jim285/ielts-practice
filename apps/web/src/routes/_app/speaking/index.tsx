import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import type { CSSProperties, ReactNode } from 'react';
import { listStyles, PanelHeader, RowChevron, rowStyles } from '@/components/bank/ListRow';
import { EASE, ModeCard } from '@/components/bank/ModeCard';
import { buttonStyles, PageContainer, PageHeader, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { formatBand, formatRelative } from '@/lib/format';
import { bandColor, type AttemptListItem } from '@/lib/result';
import { useMe } from '@/lib/query';
import { cn } from '@/lib/utils';

export const Route = createFileRoute('/_app/speaking/')({ component: SpeakingHome });

const PARTS = [
  { mode: 'p1', n: '1', title: 'Interview', desc: 'Everyday questions about you, your home, work or studies.', time: '4-5 min' },
  { mode: 'p2', n: '2', title: 'Long turn', desc: 'A cue card, one minute to prepare with notes, then up to two minutes of talking.', time: '3-4 min' },
  { mode: 'p3', n: '3', title: 'Discussion', desc: 'Abstract follow-up questions. Develop each idea with reasons and examples.', time: '4-5 min' },
] as const;

const BAND_TEXT = { good: 'text-good-text', warn: 'text-warn-text', bad: 'text-bad-text' };

function SpeakingHome() {
  return (
    <PageContainer>
      <PageHeader title="Speaking" description="Record your answers and get a band for each criterion, with every mistake and pause located in your transcript." />
      <div className="space-y-12">
        <section aria-label="Choose a mode" className="grid gap-4 lg:grid-cols-2">
          <ModeCard
            link={{ to: '/speaking/session', search: { mode: 'full' } }}
            kind="Practice test, at your own pace"
            title="Full practice test"
            body="All three parts in order, like test day. You read each question, record your answer, and every part is scored plus an overall band."
            meta="11-14 min, recorded"
            cta="Start full test"
            visual={<PartsTimeline />}
          />
          <ModeCard
            tone="brand"
            link={{ to: '/speaking/live' }}
            kind="Live, spoken conversation"
            title="Live examiner"
            body="An AI examiner asks the questions aloud, listens, and follows up on what you say, like the real interview. The whole test is scored at the end."
            meta="11-14 min, needs a microphone"
            cta="Talk to the examiner"
            visual={<Waveform />}
          />
        </section>

        <section aria-labelledby="one-h">
          <PanelHeader id="one-h" title="Or practise one part" />
          <ul className={cn(listStyles, 'stagger')}>
            {PARTS.map((p) => (
              <li key={p.mode}>
                <Link to="/speaking/session" search={{ mode: p.mode }} className={cn(rowStyles, 'min-h-[4.75rem]')}>
                  <span className="type-num w-9 shrink-0 font-serif text-3xl leading-none font-medium text-muted transition-colors duration-[120ms] group-hover:text-accent-text" aria-hidden>
                    {p.n}
                  </span>
                  <RowText title={`Part ${p.n}: ${p.title}`} desc={p.desc} />
                  <RowEnd>{p.time}</RowEnd>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <Recent />
      </div>
    </PageContainer>
  );
}

/** The full test's real structure: three parts in order, widths proportional to their length (4.5, 3.5, 4.5 min midpoints).
 *  On hover the parts fill in sequence, the order the test runs in. */
function PartsTimeline() {
  const parts = [
    { n: 1, label: 'Interview', w: 4.5 },
    { n: 2, label: 'Long turn', w: 3.5 },
    { n: 3, label: 'Discussion', w: 4.5 },
  ];
  return (
    <div className="flex gap-1.5" aria-hidden>
      {parts.map((p, i) => (
        <div key={p.n} className="min-w-0" style={{ flex: p.w }}>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div
              className={cn('h-full origin-left scale-x-0 rounded-full bg-brand transition-transform duration-300 group-hover/mode:scale-x-100 group-focus-visible/mode:scale-x-100 motion-reduce:transition-none', EASE)}
              style={{ transitionDelay: `${i * 120}ms` }}
            />
          </div>
          <p className="type-caption mt-2 truncate">
            Part {p.n}, {p.label}
          </p>
        </div>
      ))}
    </div>
  );
}

/** Voiceprint for the live mode: still at rest, "speaks" while its card is hovered or focused.
 *  Each bar has its own period and floor, so it reads as speech rather than an equaliser loop. Paused, not removed, so it never snaps. */
const VOICE = [0.22, 0.38, 0.62, 0.48, 0.8, 0.95, 0.7, 0.42, 0.28, 0.52, 0.86, 0.64, 0.4, 0.72, 0.9, 0.56, 0.34, 0.24, 0.46, 0.68, 0.36, 0.2];
function Waveform() {
  return (
    <div className="flex h-9 items-center gap-[3px]" aria-hidden>
      {VOICE.map((h, i) => (
        <span
          key={i}
          className="w-[3px] origin-center rounded-full bg-brand/70 [animation:voice_var(--d)_ease-in-out_infinite_alternate_paused] group-hover/mode:[animation-play-state:running] group-focus-visible/mode:[animation-play-state:running] motion-reduce:animate-none"
          style={{ height: `${h * 100}%`, '--d': `${0.55 + ((i * 7) % 5) * 0.11}s`, '--lo': `${0.35 + ((i * 3) % 4) * 0.12}`, animationDelay: `${-((i * 5) % 9) * 0.07}s` } as CSSProperties}
        />
      ))}
    </div>
  );
}

function RowText({ title, desc }: { title: ReactNode; desc: string }) {
  return (
    <span className="min-w-0 flex-1">
      <span className="type-subheading block">{title}</span>
      <span className="type-lede mt-0.5 block max-w-[60ch] text-sm">{desc}</span>
    </span>
  );
}

function RowEnd({ children }: { children: ReactNode }) {
  return (
    <>
      <span className="type-caption type-num hidden sm:block">{children}</span>
      <RowChevron />
    </>
  );
}

/** Last few speaking results, so the next session starts from what you just did. Shares its cache with the session switcher. Hidden until there is one. */
function Recent() {
  const { data: me } = useMe();
  const target = me?.settings.targetBand ?? 7;
  const list = useQuery({ queryKey: ['attempts', 'speaking', 1], queryFn: () => api.get<{ items: AttemptListItem[] }>('/attempts?skill=speaking&page=1') });
  const items = (list.data?.items ?? []).slice(0, 5);
  if (!list.isPending && !list.isError && items.length === 0) return null;
  return (
    <section aria-labelledby="recent">
      <PanelHeader
        id="recent"
        title="Recent results"
        meta={
          items.length > 0 && (
            <Link to="/history" search={{ skill: 'speaking' }} className={buttonStyles({ variant: 'link', className: 'hit' })}>
              View all
            </Link>
          )
        }
      />
      {list.isPending ? (
        <div className={cn(listStyles, 'py-4')} aria-busy aria-label="Loading recent results">
          {[0, 1].map((i) => (
            <div key={i} className="flex items-center justify-between gap-4 py-3">
              <div className="space-y-2">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3 w-24" />
              </div>
              <Skeleton className="h-6 w-8" />
            </div>
          ))}
        </div>
      ) : list.isError ? (
        <p className="type-lede">
          Couldn't load your results.{' '}
          <button type="button" onClick={() => void list.refetch()} className={buttonStyles({ variant: 'link' })}>
            Try again
          </button>
        </p>
      ) : (
        <ul className={cn(listStyles, 'stagger')}>
          {items.map((a) => (
            <li key={a.id}>
              <Link to="/speaking/result/$attemptId" params={{ attemptId: a.id }} className={rowStyles}>
                <RowText title={a.promptTitle} desc={`Part ${a.part}, ${formatRelative(a.createdAt)}`} />
                {a.status === 'done' && a.overall != null ? (
                  <span className={cn('type-band text-xl', BAND_TEXT[bandColor(a.overall, target)])}>
                    <span className="sr-only">Band </span>
                    {formatBand(a.overall)}
                  </span>
                ) : (
                  <span className="type-caption">{a.status === 'analyzing' ? 'Scoring' : a.status === 'failed' ? 'Failed' : 'Unsent'}</span>
                )}
                <RowChevron />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
