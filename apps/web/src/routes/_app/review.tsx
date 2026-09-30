import { review } from '@ielts/core';
import { useMutation, useSuspenseQuery, queryOptions } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { clsx } from 'clsx';
import { CircleCheck, Layers } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, buttonStyles, Card, EmptyState, PageHeader, Skeleton, toast } from '@/components/ui';
import { call, client } from '@/lib/api';
import { plural } from '@/lib/format';
import { queryClient } from '@/lib/query';

const dueQuery = queryOptions({ queryKey: ['cards', 'due'], queryFn: () => call(client.GET('/api/cards/due')), staleTime: 0 });

export const Route = createFileRoute('/_app/review')({
  loader: ({ context }) => context.queryClient.ensureQueryData(dueQuery),
  component: ReviewPage,
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
  const card = queue[i];
  const grade = useMutation({
    mutationFn: (g: number) => call(client.POST('/api/cards/{id}/review', { params: { path: { id: card!.id } }, body: { grade: g } })),
    onSuccess: (updated, g) => {
      setRevealed(false);
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
  const next = card ? GRADES.map((g) => (g.grade === 1 ? 'This session' : days(review({ ...card, due: new Date(card.due) }, g.grade).interval))) : [];
  return (
    <>
      <PageHeader title="Review" description={card ? `${plural(total - i, 'card')} due today` : undefined} />
      <div className="max-w-2xl">
        {!card && isFetching ? (
          <Skeleton className="h-72 rounded-card" />
        ) : !card ? (
          <EmptyState
            icon={<CircleCheck />}
            title="All caught up"
            action={
              <Link to="/mistakes" className={buttonStyles({ variant: 'secondary' })}>
                Browse your mistakes
              </Link>
            }
          >
            Nothing is due right now. Add mistakes and fixes from your results and they'll come back here on a spaced schedule.
          </EmptyState>
        ) : (
          <>
            <div className="mb-3 h-1 overflow-hidden rounded-full bg-line" role="progressbar" aria-label="Session progress" aria-valuemin={0} aria-valuemax={total} aria-valuenow={i}>
              <div className="h-full rounded-full bg-accent transition-[width] duration-300 ease-(--ease-out-quart)" style={{ width: `${(i / total) * 100}%` }} />
            </div>
            <Card className="flex min-h-72 flex-col" padded={false}>
              <div className="flex items-center gap-2 px-5 pt-4 text-xs text-muted">
                <Layers className="size-3.5" aria-hidden />
                {SOURCE[card.source]}
              </div>
              <div className="flex flex-1 flex-col justify-center px-5 py-8 text-center sm:px-10">
                {!revealed && <p className="mb-4 text-sm text-muted">{PROMPT[card.source]}</p>}
                <p className="font-serif text-xl leading-relaxed text-balance whitespace-pre-line sm:text-2xl">{card.front}</p>
                <div aria-live="polite">
                  {revealed && (
                    <p className="mt-6 border-t border-line pt-6 font-serif text-lg leading-relaxed text-pretty whitespace-pre-line text-ink motion-safe:animate-[fade-in_200ms_ease-out]">{card.back}</p>
                  )}
                </div>
              </div>
              <div className="border-t border-line bg-surface-2 p-3 sm:p-4">
                {!revealed ? (
                  <Button size="lg" className="w-full" onClick={() => setRevealed(true)}>
                    Show answer <kbd className="ml-1 hidden rounded bg-accent-ink/15 px-1.5 text-xs font-normal sm:inline">Space</kbd>
                  </Button>
                ) : (
                  <div className="grid grid-cols-4 gap-2" role="group" aria-label="How well did you remember?">
                    {GRADES.map((g, n) => (
                      <button
                        key={g.grade}
                        type="button"
                        disabled={grade.isPending}
                        onClick={() => grade.mutate(g.grade)}
                        className="flex h-16 flex-col items-center justify-center rounded-control border border-line bg-surface shadow-card transition-colors duration-150 hover:border-line-strong disabled:opacity-50"
                      >
                        <span className={clsx('text-sm font-semibold', g.tone)}>{g.label}</span>
                        <span className="flex items-center gap-1.5 text-xs tabular-nums text-muted">
                          {next[n]}
                          <kbd className="hidden rounded bg-ink/8 px-1.5 font-sans sm:inline" aria-hidden>
                            {g.key}
                          </kbd>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </Card>
            <p className="mt-3 text-center text-xs text-muted">Grade honestly: cards you find hard come back sooner. Again shows the card once more before you finish.</p>
          </>
        )}
      </div>
    </>
  );
}
