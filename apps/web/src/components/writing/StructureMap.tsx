import type { WritingStructure } from '@server/ai/types';
import { clsx } from 'clsx';
import { CircleCheck, CircleX, TriangleAlert } from 'lucide-react';
import { Badge, Card } from '@/components/ui';

const ROLE: Record<WritingStructure['paragraphs'][number]['role'], string> = {
  intro: 'Introduction',
  overview: 'Overview',
  body: 'Body',
  conclusion: 'Conclusion',
  greeting: 'Greeting',
  closing: 'Closing',
  other: 'Other',
};

type Check = { label: string; ok: boolean };

function CheckRow({ title, checks, note }: { title: string; checks: Check[]; note: string }) {
  return (
    <li className="px-5 py-4">
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
        {checks.map((c) => (
          <li key={c.label} className="inline-flex items-center gap-1.5">
            {c.ok ? <CircleCheck className="size-4 text-good-text" aria-label="Yes" /> : <CircleX className="size-4 text-bad-text" aria-label="No" />}
            {c.label}
          </li>
        ))}
      </ul>
      {note && <p className="mt-2 text-sm text-muted">{note}</p>}
    </li>
  );
}

/** Paragraph-by-paragraph map plus the task-level checks (T1 overview, T2 position, plan followed). */
export function StructureMap({ structure }: { structure: WritingStructure }) {
  const { paragraphs, overview, position, planFollowed } = structure;
  const hasChecks = overview || position || planFollowed;
  return (
    <div className="space-y-8">
      {hasChecks && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">Checks</h2>
          <Card padded={false}>
            <ul className="divide-y divide-line">
              {overview && (
                <CheckRow
                  title="Overview"
                  note={overview.note}
                  checks={[
                    { label: 'Overview present', ok: overview.present },
                    { label: 'States the main trends', ok: overview.mainTrends },
                    { label: 'No detailed figures in it', ok: overview.noData },
                  ]}
                />
              )}
              {position && (
                <CheckRow
                  title="Position"
                  note={position.note}
                  checks={[
                    { label: 'Clear position', ok: position.clear },
                    { label: 'Consistent throughout', ok: position.consistent },
                  ]}
                />
              )}
              {planFollowed && <CheckRow title="Your plan" note={planFollowed.note} checks={[{ label: 'Essay followed the plan', ok: planFollowed.followed }]} />}
            </ul>
          </Card>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-lg font-semibold">Paragraph map</h2>
        <ol className="relative space-y-3">
          {paragraphs.map((p, i) => (
            <li key={i} className="flex gap-3 sm:gap-4">
              <div className="flex flex-col items-center">
                <span
                  className={clsx(
                    'grid size-8 shrink-0 place-items-center rounded-full text-sm font-semibold tabular-nums',
                    p.ok ? 'bg-good-soft text-good-text' : 'bg-warn-soft text-warn-text',
                  )}
                >
                  {i + 1}
                </span>
                {i < paragraphs.length - 1 && <span className="mt-1 w-px flex-1 bg-line" aria-hidden />}
              </div>
              <Card className="min-w-0 flex-1 !p-4">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge tone="accent">{ROLE[p.role]}</Badge>
                  {p.ok ? (
                    <Badge tone="good">
                      <CircleCheck aria-hidden /> Works
                    </Badge>
                  ) : (
                    <Badge tone="warn">
                      <TriangleAlert aria-hidden /> Needs work
                    </Badge>
                  )}
                </div>
                {p.topicSentence && <p className="font-serif text-[1.0625rem] leading-relaxed italic">“{p.topicSentence}”</p>}
                {p.note && <p className="mt-2 text-sm text-muted">{p.note}</p>}
              </Card>
            </li>
          ))}
        </ol>
        {!paragraphs.length && <p className="text-sm text-muted">No paragraphs were detected. Separate paragraphs with a blank line.</p>}
      </section>
    </div>
  );
}
