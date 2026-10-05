import type { Content } from '@server/admin/schemas';
import { createFileRoute } from '@tanstack/react-router';
import { num, percent } from '@/components/admin/format';
import { Load, Section } from '@/components/admin/Load';
import { DataTable } from '@/components/admin/Table';
import { PageContainer, PageHeader, ProgressBar, Stat } from '@/components/ui';
import { useAdmin } from '@/lib/admin';

export const Route = createFileRoute('/_app/admin/content')({ component: ContentPage });

const cap = (s: string) => <span className="capitalize">{s}</span>;

function ContentPage() {
  const q = useAdmin<Content>('/content');
  return (
    <PageContainer>
      <PageHeader title="Content" description="How many questions and tests exist, and how much of the examiner voice is rendered." />
      <Load q={q} lines={4}>
        {(c) => {
          const a = c.speakingAudio;
          return (
            <>
              <Section title="Speaking and Writing prompts">
                <DataTable
                  rows={c.prompts}
                  rowKey={(p) => `${p.skill}${p.part}${p.source}`}
                  label="Prompts by skill, part and source"
                  cols={[
                    { head: 'Skill', cell: (p) => cap(p.skill) },
                    { head: 'Part', cell: (p) => <span className="type-num">{p.part}</span> },
                    { head: 'Source', cell: (p) => cap(p.source) },
                    { head: 'Prompts', cell: (p) => <span className="type-num">{num(p.count)}</span> },
                  ]}
                />
              </Section>
              <Section title="Listening and Reading tests">
                <DataTable
                  rows={c.lr}
                  rowKey={(t) => `${t.skill}${t.source}${t.variant}`}
                  label="Tests by skill, source and variant"
                  cols={[
                    { head: 'Skill', cell: (t) => cap(t.skill) },
                    { head: 'Source', cell: (t) => cap(t.source) },
                    { head: 'Variant', cell: (t) => cap(t.variant) },
                    { head: 'Tests', cell: (t) => <span className="type-num">{num(t.tests)}</span> },
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
                    <ProgressBar label="Examiner lines voiced" value={a.linesRendered / a.lines} tone={a.linesRendered === a.lines ? 'good' : 'warn'} />
                    <p className="type-caption type-num mt-1">{percent(a.linesRendered / a.lines)} of lines have audio</p>
                  </div>
                )}
              </Section>
            </>
          );
        }}
      </Load>
    </PageContainer>
  );
}
