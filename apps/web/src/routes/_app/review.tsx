import { review } from '@ielts/core';
import { useMutation, useSuspenseQuery, queryOptions } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { AccountGate } from '@/components/community/AccountGate';
import { clsx } from 'clsx';
import { CircleCheck, Layers, Volume2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, buttonStyles, Card, EmptyState, Kbd, PageContainer, PageHeader, ProgressBar, Skeleton, toast } from '@/components/ui';
import { call, client } from '@/lib/api';
import { plural } from '@/lib/format';
import { loadForAccount, queryClient, useAccount } from '@/lib/query';

const dueQuery = queryOptions({ queryKey: ['cards', 'due'], queryFn: () => call(client.GET('/api/cards/due')), staleTime: 0 });

export const Route = createFileRoute('/_app/review')({
  loader: ({ context }) => loadForAccount(context.queryClient, () => context.queryClient.ensureQueryData(dueQuery)),
  component: GatedReviewPage,
});

const GRADES = [
  { grade: 1, label: 'Again', key: '1', tone: 'text-bad-text' },
  { grade: 3, label: 'Hard', key: '2', tone: 'text-warn-text' },
  { grade: 4, label: 'Good', key: '3', tone: 'text-good-text' },
  { grade: 5, label: 'Easy', key: '4', tone: 'text-accent-text' },
] as const;

const SOURCE = { mistake: 'From your mistakes', vocab: 'Vocabulary', fix: 'Fix to practise' };
const PROMPT = {
  mistake: 'How would you correct this? Say or write it, then reveal the answer.',
  vocab: 'Recall the meaning and use it in a sentence, then reveal the answer.',
  fix: 'How would you improve this sentence? Say or write it, then reveal the answer.',
};
const days = (n: number) => (n === 1 ? '1 day' : n < 30 ? `${n} days` : `${Math.round(n / 30)} mo`);

/** A guest gets the sign-up gate instead of a page that would answer 403. */
function GatedReviewPage() {
  return useAccount() ? <ReviewPage /> : <AccountGate what="review" />;
}

function ReviewPage() {
  const { data, isFetching } = useSuspenseQuery(dueQuery);
  // The session queue: the due batch, plus every card graded Again re-queued at the end (a learning step, like Anki's).
  const [queue, setQueue] = useState(data.cards);
  const [i, setI] = useState(0);
  useEffect(() => {
    setQueue(data.cards); // a fresh batch starts from the top
    setI(0);
  }, [data]);
  const [revealed, setRevealed] = useState(false);
  const [reviewed, setReviewed] = useState(0); // graded this visit, so the end state can say so after the refetch empties the queue
  const card = queue[i];
  const deck = data.deck;
  const noCards = !reviewed && deck === 0;
  const grade = useMutation({
    mutationFn: (g: number) => call(client.POST('/api/cards/{id}/review', { params: { path: { id: card!.id } }, body: { grade: g } })),
    onSuccess: (updated, g) => {
      setRevealed(false);
      setReviewed((n) => n + 1);
      setI(i + 1);
      if (g === 1) setQueue((q) => [...q, updated]);
      else if (i + 1 >= queue.length) void queryClient.invalidateQueries({ queryKey: dueQuery.queryKey });
    },
    onError: (e) => toast(`Couldn't save that grade: ${e.message}`, { tone: 'bad' }),
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!card || grade.isPending || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.metaKey || e.ctrlKey) return;
      if (!revealed && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        setRevealed(true);
      } else if (revealed) {
        const g = GRADES.find((x) => x.key === e.key);
        if (g) grade.mutate(g.grade);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [card, revealed, grade]);

  const total = data.total + queue.length - data.cards.length;
  // Fix cards are "title\n\nsentence" (server fixCard): the title is a label, only the sentence is the thing to improve.
  const cut = card?.source === 'fix' ? card.front.indexOf('\n\n') : -1;
  const [label, front] = card && cut > 0 ? [card.front.slice(0, cut), card.front.slice(cut + 2)] : [null, card?.front];
  const word = card ? heardWord(card) : null;
  const next = card ? GRADES.map((g) => (g.grade === 1 ? 'This session' : days(review({ ...card, due: new Date(card.due) }, g.grade).interval))) : [];
  return (
    <PageContainer>
      <PageHeader title="Review" description={card ? `${plural(total - i, 'card')} left today` : 'Spaced repetition for your own corrections.'} />
      <div className="max-w-[720px]">
      {!card && isFetching ? (
        <div aria-busy>
          <Skeleton className="mb-4 h-1.5 w-full" />
          <Skeleton className="h-[26rem] rounded-lg" />
        </div>
      ) : !card ? (
        <EmptyState
          icon={noCards ? <Layers /> : <CircleCheck />}
          title={reviewed ? 'Session complete' : noCards ? 'No cards yet' : deck ? 'All caught up' : 'Nothing due right now'}
          action={
            <div className="flex flex-wrap gap-2">
              <Link to="/mistakes" className={buttonStyles({ variant: reviewed ? 'outline' : 'primary' })}>
                {noCards ? 'Go to Mistakes and add cards' : 'Browse your mistakes'}
              </Link>
              {reviewed > 0 && (
                <Link to="/" className={buttonStyles({ variant: 'primary' })}>
                  Back to dashboard
                </Link>
              )}
            </div>
          }
        >
          {reviewed
            ? `You reviewed ${plural(reviewed, 'card')}. Each one comes back when it is due, so a short session tomorrow keeps them fresh.`
            : noCards
              ? 'Your deck is empty. Open Mistakes and press Add to deck on the corrections you want to remember; they come back here on a spaced schedule.'
              : deck
                ? "Your cards come back here when they're due. Add more mistakes and fixes from your results any time."
                : "Cards come back here on a spaced schedule. Add mistakes and fixes from your results to build your deck."}
        </EmptyState>
      ) : (
        <>
          <div className="mb-3 flex items-center gap-3">
            <ProgressBar value={i / total} label="Session progress" className="h-1.5 flex-1" />
            <span className="type-num type-caption" aria-hidden>
              {i} / {total}
            </span>
          </div>
          <Card className="flex min-h-[26rem] flex-col overflow-clip" padded={false}>
            <div key={`${card.id}-${i}`} className="page-enter flex flex-1 flex-col">
              <div className="type-caption flex items-center gap-2 px-5 pt-4 sm:px-8 sm:pt-5">
                <Layers className="size-4" aria-hidden />
                {SOURCE[card.source]}
              </div>
              <div className="flex flex-1 flex-col justify-center px-5 py-8 sm:px-8">
                {!revealed && <p className="type-caption mb-4 max-w-[52ch]">{PROMPT[card.source]}</p>}
                {label && <p className="mb-2 text-sm font-medium text-accent-text">{label}</p>}
                <p className="max-w-[36ch] type-title-sm text-balance whitespace-pre-line">{front}</p>
                {word && canSpeak() && (
                  <Button variant="outline" className="mt-5 w-fit" onClick={() => say(word)}>
                    <Volume2 aria-hidden />
                    Hear the word
                  </Button>
                )}
                <div aria-live="polite">
                  {revealed && <p className="type-reading mt-6 max-w-[52ch] border-t border-line pt-6 text-pretty whitespace-pre-line text-ink motion-safe:animate-[rise-in_320ms_var(--ease-out-expo)]">{card.back}</p>}
                </div>
              </div>
            </div>
            <div className="border-t border-line bg-surface-2 p-3 sm:p-4">
              {!revealed ? (
                <Button size="lg" className="w-full" onClick={() => setRevealed(true)}>
                  Show answer <Kbd onBrand className="ml-1 hidden sm:inline-flex">Space</Kbd>
                </Button>
              ) : (
                <div className="grid grid-cols-4 gap-2" role="group" aria-label="How well did you remember?">
                  {GRADES.map((g, n) => (
                    <Button key={g.grade} variant="outline" disabled={grade.isPending} onClick={() => grade.mutate(g.grade)} className="h-auto min-h-14 min-w-0 flex-col gap-0.5 px-1 py-2 md:h-auto">
                      <span className={clsx('text-sm font-semibold', g.tone)}>{g.label}</span>
                      <span className="type-num flex items-center gap-1.5 text-xs font-normal text-muted">
                        {next[n]}
                        <Kbd className="hidden sm:inline-flex" aria-hidden>
                          {g.key}
                        </Kbd>
                      </span>
                    </Button>
                  ))}
                </div>
              )}
            </div>
          </Card>
          <p className="type-caption mt-4 max-w-[65ch]">Grade honestly: cards you find hard come back sooner. Again shows the card once more before you finish.</p>
        </>
      )}
      </div>
    </PageContainer>
  );
}

/** Listening spelling cards ("🎧 Listening · spell the word you heard…") keep the word as the first line of the back. */
const heardWord = (c: { front: string; back: string }) => (c.front.startsWith('🎧 Listening') ? c.back.split('\n')[0]!.trim() || null : null);
const canSpeak = () => typeof window !== 'undefined' && 'speechSynthesis' in window;
/** The device's own British English voice, a little slow; the spelling stays hidden until the card is turned. ponytail: not the test speaker's voice; play the clip from the test audio if that matters. */
function say(word: string) {
  const u = new SpeechSynthesisUtterance(word);
  u.lang = 'en-GB';
  u.rate = 0.85;
  u.voice = speechSynthesis.getVoices().find((v) => v.lang === 'en-GB') ?? null;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}
