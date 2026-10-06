import type { AnalysisResult, Fix } from '@server/ai/types';
import { useMutation } from '@tanstack/react-query';
import { BookmarkCheck, BookmarkPlus } from 'lucide-react';
import { Alert, Button, toast } from '@/components/ui';
import { Section } from '@/components/result';
import { addFixesToDeck } from '@/lib/result';

export type AddFixes = { add: () => void; added: boolean; pending: boolean };

/** "Add the top fixes to the review deck", shared by Overview (the fix list) and Improve so both show the same state. */
export function useAddFixes(fixes: Fix[], inDeck: boolean): AddFixes {
  const m = useMutation({
    mutationFn: () => addFixesToDeck(fixes),
    onSuccess: () => toast(`Added ${fixes.length} cards to your review deck`, { tone: 'good' }),
    onError: (e) => toast(e.message, { tone: 'bad' }),
  });
  return { add: () => m.mutate(), added: inDeck || m.isSuccess, pending: m.isPending };
}

/** Improve tab: the band+1 rewrite of their own answer, then the fixes as review cards. Retry lives in the action row above the tabs. */
export function ImprovePanel({ result, deck }: { result: AnalysisResult; deck: AddFixes }) {
  return (
    <div className="space-y-8 md:space-y-12">
      {result.rewrite.text && (
        <Section title="Your answer, one band higher">
          <p className="type-reading max-w-[68ch] whitespace-pre-wrap">{result.rewrite.text}</p>
          {result.rewrite.note && <Alert>{result.rewrite.note}</Alert>}
        </Section>
      )}
      {!result.rewrite.text && result.topFixes.length === 0 && <Section title="Improve" caption="Nothing more to suggest for this answer." />}
      {result.topFixes.length > 0 && (
        <Section title="Keep the fixes" caption="Turn the things to fix next into review cards, so they come back before you forget them.">
          <Button variant="outline" icon={deck.added ? <BookmarkCheck /> : <BookmarkPlus />} loading={deck.pending} disabled={deck.added} onClick={deck.add}>
            {deck.added ? 'Added to review deck' : 'Add top fixes to review deck'}
          </Button>
        </Section>
      )}
    </div>
  );
}
