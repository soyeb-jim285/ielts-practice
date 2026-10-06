import { Badge } from '@/components/ui';
import { ScoreHero } from '@/components/result';
import type { Mock } from '@/lib/mock';

/** The headline of a mock: the overall band with its gap to target, or why there is none yet. The four section bands under it are SectionList. */
export function MockResult({ mock, target }: { mock: Mock; target: number }) {
  const pending = mock.sections.some((s) => s.state === 'marking');
  const closed = mock.status === 'closed';
  const empty = closed ? 'This mock was finished without Speaking, so it has no overall band.' : pending ? 'Overall appears when all four sections are marked. Marking takes about a minute.' : 'Overall appears when all four sections are marked.';
  return (
    <ScoreHero
      value={mock.overall}
      target={target}
      emptyText={empty}
      exceptions={closed && <Badge tone="warn">Finished without Speaking</Badge>}
    />
  );
}
