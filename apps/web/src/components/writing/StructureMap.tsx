import type { WritingStructure } from '@server/ai/types';
import { clsx } from 'clsx';
import { CircleCheck, CircleX, TriangleAlert } from 'lucide-react';
import { Section } from '@/components/result';

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

function CheckGroup({ title, checks, note }: { title: string; checks: Check[]; note: string }) {
  return (
    <li className="min-w-0 space-y-2">
      <h3 className="type-subheading">{title}</h3>
      <ul className="space-y-1">
        {checks.map((c) => (
          <li key={c.label} className="type-body flex items-start gap-2">
            {c.ok ? <CircleCheck role="img" className="mt-0.5 size-4 shrink-0 text-good-text" aria-label="Yes" /> : <CircleX role="img" className="mt-0.5 size-4 shrink-0 text-bad-text" aria-label="No" />}
            {c.label}
          </li>
        ))}
      </ul>
      {note && <p className="type-caption">{note}</p>}
    </li>
  );
}

/** Paragraph-by-paragraph map plus the task-level checks (T1 overview, T2 position, plan followed). */
export function StructureMap({ structure }: { structure: WritingStructure }) {
  const { paragraphs, overview, position, planFollowed } = structure;
  const hasChecks = overview || position || planFollowed;
  return (
    <>
      {hasChecks && (
        <Section title="Checks">
          <ul className="grid gap-6 sm:grid-cols-3">
            {overview && (
              <CheckGroup
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
              <CheckGroup
                title="Position"
                note={position.note}
                checks={[
                  { label: 'Clear position', ok: position.clear },
                  { label: 'Consistent throughout', ok: position.consistent },
                ]}
              />
            )}
            {planFollowed && <CheckGroup title="Your plan" note={planFollowed.note} checks={[{ label: 'Essay followed the plan', ok: planFollowed.followed }]} />}
          </ul>
        </Section>
      )}

      <Section title="Paragraph map">
        {paragraphs.length ? (
          <ol className="max-w-[68ch] divide-y divide-line">
            {paragraphs.map((p, i) => (
              <li key={i} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-2 py-4 first:pt-0">
                <span className="type-subheading type-num" aria-hidden>
                  {i + 1}.
                </span>
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                    <h3 className="type-subheading">
                      <span className="sr-only">Paragraph {i + 1}: </span>
                      {ROLE[p.role]}
                    </h3>
                    <p className={clsx('type-body inline-flex items-center gap-1.5', p.ok ? 'text-good-text' : 'text-warn-text')}>
                      {p.ok ? <CircleCheck className="size-4" aria-hidden /> : <TriangleAlert className="size-4" aria-hidden />}
                      {p.ok ? 'Works' : 'Needs work'}
                    </p>
                  </div>
                  {p.topicSentence && <p className="type-reading-sm">“{p.topicSentence}”</p>}
                  {p.note && <p className="type-caption">{p.note}</p>}
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="type-body text-muted">No paragraphs were detected. Separate paragraphs with a blank line.</p>
        )}
      </Section>
    </>
  );
}
