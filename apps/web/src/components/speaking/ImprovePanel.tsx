import type { AnalysisResult } from '@server/ai/types';
import { useMutation } from '@tanstack/react-query';
import { BookmarkPlus } from 'lucide-react';
import type { ReactNode } from 'react';
import { Alert, Button, Card, toast } from '@/components/ui';
import { addFixesToDeck } from '@/lib/result';

/** Improve tab: band+1 rewrite of their own answer, retry (child attempt), and "add all fixes to deck". */
export function ImprovePanel({ result, retry }: { result: AnalysisResult; retry: ReactNode }) {
  const add = useMutation({
    mutationFn: () => addFixesToDeck(result.topFixes),
    onSuccess: () => toast(`Added ${result.topFixes.length} cards to your review deck`, { tone: 'good' }),
    onError: (e) => toast(e.message, { tone: 'bad' }),
  });
  return (
    <div className="space-y-8">
      {result.rewrite.text && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">Your answer, one band higher</h2>
          <Card>
            <p className="prose-serif whitespace-pre-wrap">{result.rewrite.text}</p>
          </Card>
          {result.rewrite.note && (
            <Alert tone="warn" className="mt-3">
              {result.rewrite.note}
            </Alert>
          )}
        </section>
      )}
      <section className="flex flex-col gap-4 rounded-card bg-surface-2 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold">Put it into practice</h2>
          <p className="mt-1 text-sm text-muted">Answer the same question again and see how each criterion moves.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {result.topFixes.length > 0 && (
            <Button variant="secondary" icon={<BookmarkPlus />} loading={add.isPending} disabled={add.isSuccess} onClick={() => add.mutate()}>
              {add.isSuccess ? 'Fixes in your deck' : 'Add top fixes to deck'}
            </Button>
          )}
          {retry}
        </div>
      </section>
    </div>
  );
}
