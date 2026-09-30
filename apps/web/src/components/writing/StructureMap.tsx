import type { WritingStructure } from '@server/ai/types';
import { clsx } from 'clsx';
import { CircleCheck, CircleX, TriangleAlert } from 'lucide-react';
import { Card } from '@/components/ui';

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
            {c.ok ? <CircleCheck role="img" className="size-4 text-good-text" aria-label="Yes" /> : <CircleX role="img" className="size-4 text-bad-text" aria-label="No" />}
            {c.label}
          </li>
        ))}
      </ul>
      {note && <p className="mt-2 max-w-prose text-sm text-muted text-pretty">{note}</p>}
    </li>
  );
}

/** Paragraph-by-paragraph map plus the task-level checks (T1 overview, T2 position, plan followed). */
export function StructureMap({ structure }: { structure: WritingStructure }) {
  const { paragraphs, overview, position, planFollowed } = structure;
  const hasChecks = overview || position || planFollowed;
  return (
    <div className="space-y-10">
      {hasChecks && (
        <section>
          <h2 className="mb-3 type-heading">Checks</h2>
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
        <h2 className="mb-3 type-heading">Paragraph map</h2>
        {paragraphs.length ? (
          <Card padded={false}>
            <ol className="divide-y divide-line">
              {paragraphs.map((p, i) => (
                <li key={i} className="flex gap-4 px-5 py-4">
                  <span className="grid size-8 shrink-0 place-items-center rounded-md bg-surface-2 text-sm font-semibold type-num" aria-hidden>
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                      <span className="font-semibold">
                        <span className="sr-only">Paragraph {i + 1}: </span>
                        {ROLE[p.role]}
                      </span>
                      <span className={clsx('inline-flex items-center gap-1.5', p.ok ? 'text-good-text' : 'text-warn-text')}>
                        {p.ok ? <CircleCheck className="size-4" aria-hidden /> : <TriangleAlert className="size-4" aria-hidden />}
                        {p.ok ? 'Works' : 'Needs work'}
                      </span>
                    </p>
                    {p.topicSentence && <p className="type-reading">“{p.topicSentence}”</p>}
                    {p.note && <p className="max-w-prose text-sm text-muted text-pretty">{p.note}</p>}
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        ) : (
          <p className="text-sm text-muted">No paragraphs were detected. Separate paragraphs with a blank line.</p>
        )}
      </section>
    </div>
  );
}
