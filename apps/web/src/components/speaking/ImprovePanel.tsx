import type { AnalysisResult } from '@server/ai/types';
import { useMutation } from '@tanstack/react-query';
import { BookmarkCheck, BookmarkPlus } from 'lucide-react';
import type { ReactNode } from 'react';
import { Alert, Button, Card, toast } from '@/components/ui';
import { addFixesToDeck } from '@/lib/result';

/** Improve tab: band+1 rewrite of their own answer, retry (child attempt), and "add all fixes to deck". */
export function ImprovePanel({ result, retry, inDeck }: { result: AnalysisResult; retry: ReactNode; inDeck: boolean }) {
  const add = useMutation({
    mutationFn: () => addFixesToDeck(result.topFixes),
    onSuccess: () => toast(`Added ${result.topFixes.length} cards to your review deck`, { tone: 'good' }),
    onError: (e) => toast(e.message, { tone: 'bad' }),
  });
  const added = inDeck || add.isSuccess;
  return (
    <div className="space-y-10">
      {/* Actions first, as on the writing result. */}
      <div className="flex flex-wrap gap-2">
        {retry}
        {result.topFixes.length > 0 && (
          <Button variant="outline" icon={added ? <BookmarkCheck /> : <BookmarkPlus />} loading={add.isPending} disabled={added} onClick={() => add.mutate()}>
            {added ? 'Added to review deck' : 'Add top fixes to review deck'}
          </Button>
        )}
      </div>
      {result.rewrite.text && (
        <section className="max-w-[calc(68ch+3.5rem)] space-y-4">
          <h2 className="type-heading">Your answer, one band higher</h2>
          <Card className="sm:p-7">
            <p className="type-reading whitespace-pre-wrap">{result.rewrite.text}</p>
          </Card>
          {result.rewrite.note && <Alert>{result.rewrite.note}</Alert>}
        </section>
      )}
    </div>
  );
}
