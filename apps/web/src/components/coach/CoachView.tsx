import { Link } from '@tanstack/react-router';
import { Compass, LoaderCircle } from 'lucide-react';
import { useState } from 'react';
import { Section } from '@/components/result';
import { Badge, buttonStyles, EmptyState, PageContainer, PageHeader, toast } from '@/components/ui';
import { call, client } from '@/lib/api';
import { formatBand, formatDate, plural } from '@/lib/format';
import { useAccount } from '@/lib/query';
import { CheatSheet } from './CheatSheet';
import { type Coach, type Feedback, itemKey, type Report } from './data';
import { FocusList } from './FocusList';
import { daysUntil, GoalControls } from './GoalControls';
import { Patterns } from './Patterns';
import { SkillCards } from './SkillCards';
import { Summary, Win } from './Summary';
import { WeekPlan } from './WeekPlan';

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
/** Report day (the student's local YYYY-MM-DD) as "today", "yesterday", "3 days ago". */
const relativeDay = (day: string) => rtf.format(-Math.round((Date.parse(new Date().toLocaleDateString('en-CA')) - Date.parse(day)) / 86_400_000), 'day');

/** The coach page body for a loaded GET /api/coach response. */
export function CoachView({ data }: { data: Coach }) {
  if (data.state === 'empty' || !data.report)
    return (
      <PageContainer>
        <PageHeader title="Your coach" />
        {data.updating ? (
          <EmptyState icon={<LoaderCircle className="animate-spin" />} title="Your coach is reading your tests…">
            <span role="status">Your first report takes about a minute. This page updates by itself.</span>
          </EmptyState>
        ) : (
          <EmptyState
            icon={<Compass />}
            title="Your coach starts after your first test"
            action={
              <Link to="/writing" className={buttonStyles()}>
                Write your first essay
              </Link>
            }
          >
            It reads all your tests together and shows where you stand in each skill, the 3 things most worth fixing this week, the habits that keep coming back, and a short plan for your week.
          </EmptyState>
        )}
      </PageContainer>
    );
  return <Ready report={data.report} updating={data.updating} />;
}

function Updating() {
  return (
    <p className="type-caption mb-6 flex items-center gap-2" role="status">
      <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
      Updating your coach…
    </p>
  );
}

function Ready({ report, updating }: { report: Report; updating: boolean }) {
  const { facts, words } = report;
  const account = useAccount();
  const [gone, setGone] = useState<string[]>([]);
  const fb: Feedback = {
    hidden: new Set([...report.hidden, ...gone]),
    wrong: (key) => {
      setGone((g) => [...g, key]);
      call(client.POST('/api/coach/feedback', { body: { reportId: report.id, itemKey: key } })).then(
        () => toast('Thanks. That item is hidden until your next report.'),
        (e: Error) => {
          setGone((g) => g.filter((k) => k !== key));
          toast(`Couldn't save that: ${e.message}`, { tone: 'bad' });
        },
      );
    },
  };
  const examDate = account ? account.settings.examDate : facts.examDate;
  const days = daysUntil(examDate);

  return (
    <PageContainer>
      <PageHeader
        title="Your coach"
        description={
          <span className="flex flex-col gap-2">
            <span>
              Updated {relativeDay(report.day)}, from {plural(facts.totalTests, 'test')}.
            </span>
            <span className="flex flex-wrap gap-2">
              {facts.target != null && <Badge tone="accent">Target band {formatBand(facts.target)}</Badge>}
              {examDate && days != null && (
                <Badge>
                  Exam {formatDate(examDate)} · {days === 0 ? 'today' : plural(days, 'day')}
                </Badge>
              )}
            </span>
          </span>
        }
        actions={account && <GoalControls chosen={facts.target} />}
      />
      {updating && <Updating />}

      <div className="space-y-10">
        <Summary text={words.summary} />

        <Section title="By skill">
          <SkillCards skills={facts.skills} target={facts.target} />
        </Section>

        {words.focus.length > 0 && (
          <Section title="This week's focus" caption="In order of how much they would lift your band.">
            <FocusList focus={words.focus} candidates={facts.candidates} fb={fb} />
          </Section>
        )}

        {words.win && <Win text={words.win} />}

        <Section title="Your patterns" caption="What keeps happening across your recent tests.">
          <Patterns facts={facts} fb={fb} />
        </Section>

        {words.cheat.some((c) => !fb.hidden.has(itemKey('cheat', c.candidateId))) && (
          <Section title="Before your next test" caption="Read this just before you start.">
            <CheatSheet cheat={words.cheat} fb={fb} />
          </Section>
        )}

        {words.plan.length > 0 && (
          <Section title="Your week" caption={days != null ? `Sized to the ${plural(days, 'day')} left before your exam.` : 'Tap a line to start it.'}>
            <WeekPlan plan={words.plan} />
          </Section>
        )}
      </div>
    </PageContainer>
  );
}
