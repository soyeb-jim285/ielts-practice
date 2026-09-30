import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowRight, AudioLines } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { listStyles, PanelHeader, RowChevron, rowStyles } from '@/components/bank/ListRow';
import { buttonStyles, Card, PageContainer, PageHeader, Skeleton } from '@/components/ui';
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
          <Card tone="hero" className="flex flex-col justify-between gap-8 sm:p-7">
            <div>
              <p className="type-caption">Practice test, at your own pace</p>
              <h2 className="type-title-sm mt-2">Full practice test</h2>
              <p className="type-lede mt-2 max-w-[44ch]">All three parts in order, like test day. You read each question, record your answer, and get every part scored plus an overall band.</p>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <p className="type-caption type-num">11-14 min, recorded</p>
              <Link to="/speaking/session" search={{ mode: 'full' }} className={buttonStyles({ size: 'lg', className: 'w-full sm:w-auto sm:px-6' })}>
                Start full test <ArrowRight aria-hidden />
              </Link>
            </div>
          </Card>

          <div className="group/live relative flex flex-col justify-between gap-8 overflow-hidden rounded-lg bg-foreground p-6 text-background transition-[transform,box-shadow] duration-200 ease-[cubic-bezier(0.25,1,0.5,1)] focus-within:-translate-y-0.5 hover:-translate-y-0.5 hover:shadow-lg motion-reduce:transform-none sm:p-7">
            <div>
              <p className="type-caption flex items-center gap-2 text-background/75">
                <span className="size-2 rounded-full bg-[#2dd4bf] shadow-[0_0_0_3px_rgb(45_212_191/0.22)]" aria-hidden />
                Live, spoken conversation
              </p>
              <h2 className="type-title-sm mt-2 text-background">Live examiner</h2>
              <p className="mt-2 max-w-[44ch] text-body leading-relaxed text-background/80">
                An AI examiner asks the questions aloud, listens, and follows up on what you say, just like the real interview. The whole test is scored when you finish.
              </p>
            </div>
            <Waveform />
            <div className="flex flex-wrap items-center justify-between gap-4">
              <p className="type-caption type-num text-background/75">11-14 min, needs a microphone</p>
              <Link to="/speaking/live" className={buttonStyles({ size: 'lg', className: 'w-full bg-background text-foreground hover:bg-background/90 sm:w-auto sm:px-6' })}>
                <AudioLines aria-hidden /> Talk to the examiner <ArrowRight aria-hidden className="transition-transform duration-200 ease-[cubic-bezier(0.25,1,0.5,1)] group-hover/live:translate-x-0.5 motion-reduce:transition-none" />
              </Link>
            </div>
          </div>
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

/** Voiceprint for the live card: still at rest, "speaks" while the card is hovered or focused (the state the motion conveys).
 *  Each bar has its own period and floor, so the motion reads as speech rather than an equaliser loop. Paused, not removed, so it never snaps. */
const VOICE = [0.22, 0.38, 0.62, 0.48, 0.8, 0.95, 0.7, 0.42, 0.28, 0.52, 0.86, 0.64, 0.4, 0.72, 0.9, 0.56, 0.34, 0.24];
function Waveform() {
  return (
    <div className="flex h-10 items-center gap-[3px]" aria-hidden>
      {VOICE.map((h, i) => (
        <span
          key={i}
          className="w-[3px] origin-center rounded-full bg-[#2dd4bf]/85 [animation:voice_var(--d)_ease-in-out_infinite_alternate_paused] group-hover/live:[animation-play-state:running] group-focus-within/live:[animation-play-state:running] motion-reduce:animate-none"
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
