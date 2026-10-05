import type { Content } from '@server/admin/schemas';
import { CircleCheck, TriangleAlert } from 'lucide-react';
import { useAdmin } from '@/lib/admin';
import { Badge, ProgressBar, Stat } from '@/components/ui';
import { num, percent } from './format';
import { Load, Section } from './Load';
import { DataTable } from './Table';

const cap = (s: string) => <span className="capitalize">{s}</span>;

/** What exists: prompts and tests by skill and source, plus how much of the examiner voice is rendered. Gaps get a chip, not a silent zero. */
export function Inventory() {
  const q = useAdmin<Content>('/content');
  return (
    <Load q={q} lines={4}>
      {(c) => {
        const a = c.speakingAudio;
        const gap = a.lines - a.linesRendered;
        return (
          <>
            <Section title="Speaking and Writing prompts">
              <DataTable
                dense
                rows={c.prompts}
                rowKey={(p) => `${p.skill}${p.part}${p.source}`}
                label="Prompts by skill, part and source"
                cols={[
                  { head: 'Skill', cell: (p) => cap(p.skill) },
                  { head: 'Part', cell: (p) => <span className="type-num">{p.part}</span> },
                  { head: 'Source', cell: (p) => cap(p.source) },
                  { head: 'Prompts', className: 'text-right', cell: (p) => <span className="type-num">{num(p.count)}</span> },
                ]}
              />
            </Section>
            <Section title="Listening and Reading tests">
              <DataTable
                dense
                rows={c.lr}
                rowKey={(t) => `${t.skill}${t.source}${t.variant}`}
                label="Tests by skill, source and variant"
                cols={[
                  { head: 'Skill', cell: (t) => cap(t.skill) },
                  { head: 'Source', cell: (t) => cap(t.source) },
                  { head: 'Variant', cell: (t) => cap(t.variant) },
                  { head: 'Tests', className: 'text-right', cell: (t) => <span className="type-num">{num(t.tests)}</span> },
                ]}
              />
            </Section>
            <Section title="Examiner voice" aside="Generated speaking prompts only">
              <dl className="grid grid-cols-2 gap-x-6 gap-y-6 md:grid-cols-4">
                <Stat label="Prompts fully voiced" value={`${a.promptsFullyRendered} / ${a.prompts}`} />
                <Stat label="Lines voiced" value={`${num(a.linesRendered)} / ${num(a.lines)}`} />
                <Stat label="Files in storage" value={num(a.manifestEntries)} hint={a.manifestEntries == null ? 'Manifest missing' : undefined} />
              </dl>
              {a.lines > 0 && (
                <div className="mt-6 max-w-md">
                  <ProgressBar label="Examiner lines voiced" value={a.linesRendered / a.lines} tone={gap === 0 ? 'good' : 'warn'} />
                  <p className="type-caption type-num mt-1 flex items-center gap-2">
                    {percent(a.linesRendered / a.lines)} of lines have audio
                    {gap === 0 ? <Badge tone="good"><CircleCheck /> Complete</Badge> : <Badge tone="warn"><TriangleAlert /> {num(gap)} missing</Badge>}
                  </p>
                </div>
              )}
            </Section>
          </>
        );
      }}
    </Load>
  );
}
