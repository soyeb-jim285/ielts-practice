import { ArrowRight } from 'lucide-react';
import { Alert, Button, Card } from '@/components/ui';
import { SKILL_LABEL, transitionCopy, type Mock } from '@/lib/mock';

/** Between sections: what just finished, what is next, one Start button. Nothing runs here; a section's clock starts only inside the section. */
export function Transition({ mock, onStart, busy, error }: { mock: Mock; onStart: () => void; busy: boolean; error?: string }) {
  const copy = transitionCopy(mock);
  const next = mock.next;
  if (!copy || !next || next === 'speaking') return null;
  const resuming = mock.sections.find((s) => s.skill === next)?.state === 'in_progress';
  return (
    <Card tone="hero" className="flex flex-col gap-5 sm:p-7">
      <div>
        <p className="type-caption font-medium text-accent-text">Full mock test</p>
        <h2 className="type-title-sm mt-2 text-balance">{copy.title}</h2>
        <p className="type-lede mt-2 max-w-[56ch]">{resuming ? `${SKILL_LABEL[next]} is already under way. You resume with the time you have used.` : copy.body}</p>
      </div>
      {error && <Alert tone="bad">{error}</Alert>}
      <div>
        <Button size="lg" icon={<ArrowRight />} onClick={onStart} loading={busy} className="max-sm:w-full">
          {resuming ? 'Continue' : 'Start'} {SKILL_LABEL[next]}
        </Button>
      </div>
    </Card>
  );
}
