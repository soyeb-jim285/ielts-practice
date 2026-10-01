import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link, type LinkProps } from '@tanstack/react-router';
import { ArrowRight, AudioLines, ListOrdered } from 'lucide-react';
import type { ReactNode } from 'react';
import { listStyles, PanelHeader, RowChevron, rowStyles } from '@/components/bank/ListRow';
import { PendingUploads } from '@/components/speaking/PendingUploads';
import { buttonStyles, PageContainer, PageHeader, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { formatBand, formatRelative } from '@/lib/format';
import { bandColor, sentenceCase, type AttemptListItem } from '@/lib/result';
import { useMe } from '@/lib/query';
import { cn } from '@/lib/utils';

export const Route = createFileRoute('/_app/speaking/')({ component: SpeakingHome });

const PARTS = [
  { mode: 'p1', n: '1', title: 'Interview', desc: 'Everyday questions about you, your home, work or studies.', time: '4-5 min' },
  { mode: 'p2', n: '2', title: 'Long turn', desc: 'A cue card, one minute to prepare with notes, then up to two minutes of talking.', time: '3-4 min' },
  { mode: 'p3', n: '3', title: 'Discussion', desc: 'Abstract follow-up questions. Develop each idea with reasons and examples.', time: '4-5 min' },
] as const;

const BAND_TEXT = { good: 'text-good-text', warn: 'text-warn-text', bad: 'text-bad-text' };

/** Shared with the session switcher's cache. */
const useRecentAttempts = () => {
  const signedIn = !!useMe().data; // guests have no attempts
  return useQuery({ enabled: signedIn, queryKey: ['attempts', 'speaking', 1], queryFn: () => api.get<{ items: AttemptListItem[] }>('/attempts?skill=speaking&page=1') });
};

function SpeakingHome() {
  // No attempts yet: the first action is a single part, so that list leads (order-first) and the full modes follow.
  const list = useRecentAttempts();
  const fresh = !useMe().data || (list.isSuccess && list.data.items.length === 0);
  return (
    <PageContainer>
      <PageHeader title="Speaking" description="Record your answers and get a band for each criterion, with every mistake and pause located in your transcript." />
      <div className="flex flex-col gap-12">
        <PendingUploads />
        <section aria-label="Choose a mode" className="grid gap-4 lg:grid-cols-2">
          <ModeCard
            link={{ to: '/speaking/session', search: { mode: 'full' } }}
            icon={<ListOrdered />}
            kind="Practice test, at your own pace"
            title="Full practice test"
            body="All three parts in order, like test day. You read each question, record your answer, and every part is scored plus an overall band."
            meta="11-14 min, recorded"
            cta="Start full test"
          />
          <ModeCard
            link={{ to: '/speaking/live' }}
            tone="live"
            icon={<AudioLines />}
            kind="Live, spoken conversation"
            title="Live examiner"
            body="An AI examiner asks the questions aloud, listens, and follows up on what you say, like the real interview. The whole test is scored at the end."
            meta="11-14 min, needs a microphone"
            cta="Talk to the examiner"
          />
        </section>

        <section aria-labelledby="one-h" className={cn(fresh && 'order-first')}>
          <PanelHeader id="one-h" title={fresh ? 'Start with one part' : 'Or practise one part'} />
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

/** One of the two ways to practise. Static card; the button is the only interactive part.
 *  Colour tells the modes apart without a second accent: the self-paced test sits on a cool slate wash, the live examiner on a soft teal wash
 *  (teal = the spoken, "live" mode). Both washes are mixes of existing tokens, so dark mode and contrast follow the palette. */
const MODE_TONE = {
  test: { card: 'border-line bg-[color-mix(in_oklab,var(--surface-2)_75%,var(--surface))]', icon: 'text-ink' },
  live: { card: 'border-brand/25 bg-[color-mix(in_oklab,var(--accent-soft)_70%,var(--surface))]', icon: 'text-accent-text' },
};
function ModeCard({ link, tone = 'test', icon, kind, title, body, meta, cta }: { link: LinkProps; tone?: keyof typeof MODE_TONE; icon: ReactNode; kind: string; title: string; body: string; meta: string; cta: string }) {
  const t = MODE_TONE[tone];
  return (
    <div className={cn('flex flex-col gap-6 rounded-lg border p-6 sm:p-7', t.card)}>
      <div>
        <p className="type-caption flex items-center gap-2">
          <span aria-hidden className={cn('[&_svg]:size-4', t.icon)}>
            {icon}
          </span>
          {kind}
        </p>
        <h2 className="type-title-sm mt-2">{title}</h2>
        <p className="type-lede mt-2 max-w-[46ch]">{body}</p>
      </div>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <span className="type-caption type-num">{meta}</span>
        <Link {...link} className={buttonStyles({ variant: 'outline' })}>
          {cta}
          <ArrowRight aria-hidden />
        </Link>
      </div>
    </div>
  );
}

function RowText({ title, desc }: { title: ReactNode; desc: string }) {
  return (
    <span className="min-w-0 flex-1">
      <span className="type-subheading block">{title}</span>
      <span className="type-lede mt-0.5 block max-w-[72ch] text-sm">{desc}</span>
    </span>
  );
}

/** Duration flush with the row's right edge; on hover it gives way to the arrow (same slot), instead of reserving a gap for it. */
function RowEnd({ children }: { children: ReactNode }) {
  return (
    <span className="relative grid place-items-center self-stretch">
      <span className="type-caption type-num hidden text-right transition-opacity duration-[120ms] group-hover:opacity-0 group-focus-visible:opacity-0 sm:block">{children}</span>
      <span className="absolute right-0 flex">
        <RowChevron />
      </span>
    </span>
  );
}

/** Last few speaking results, so the next session starts from what you just did. Shares its cache with the session switcher. Hidden until there is one. */
function Recent() {
  const { data: me } = useMe();
  const target = me?.settings.targetBand ?? 7;
  const list = useRecentAttempts();
  const items = (list.data?.items ?? []).slice(0, 5);
  if (!me || (!list.isPending && !list.isError && items.length === 0)) return null;
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
                <RowText title={sentenceCase(a.promptTitle)} desc={`Part ${a.part}, ${formatRelative(a.createdAt)}`} />
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
