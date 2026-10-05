import type { Overview } from '@server/admin/schemas';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Load, Section } from '@/components/admin/Load';
import { dhakaTime } from '@/components/admin/format';
import { PageContainer, PageHeader, Stat } from '@/components/ui';
import { useAdmin } from '@/lib/admin';

export const Route = createFileRoute('/_app/admin/')({ component: OverviewPage });

const SKILLS = ['speaking', 'writing', 'listening', 'reading'] as const;
const grid = 'grid grid-cols-2 gap-x-6 gap-y-6 md:grid-cols-3';

function OverviewPage() {
  const q = useAdmin<Overview>('/overview');
  return (
    <PageContainer>
      <PageHeader title="Overview" description={q.data && `As of ${dhakaTime(q.data.generatedAt)} Dhaka time. A day means a Dhaka calendar day.`} />
      <Load q={q} lines={4}>
        {(o) => (
          <>
            <Section title="People">
              <dl className={grid}>
                <Stat label="Accounts" value={o.accounts} />
                <Stat label="Guests" value={o.guests} hint="Purged after 30 days" />
                <Stat label="Feedback to read" value={<Link to="/admin/feedback" className="underline-offset-4 hover:underline">{o.feedbackNew}</Link>} />
              </dl>
            </Section>
            <Section title="Sign-ups">
              <dl className={grid}>
                <Stat label="Today" value={o.signups.today} hint={`${o.newGuests.today} new guests`} />
                <Stat label="Last 7 days" value={o.signups.d7} hint={`${o.newGuests.d7} new guests`} />
                <Stat label="Last 30 days" value={o.signups.d30} hint={`${o.newGuests.d30} new guests`} />
              </dl>
            </Section>
            <Section title="Active people" aside="Did at least one test or opened the site">
              <dl className={grid}>
                <Stat label="Accounts today" value={o.activeUsers.today.accounts} />
                <Stat label="Guests today" value={o.activeUsers.today.guests} />
                <span className="hidden md:block" />
                <Stat label="Accounts, 7 days" value={o.activeUsers.d7.accounts} />
                <Stat label="Guests, 7 days" value={o.activeUsers.d7.guests} />
              </dl>
            </Section>
            <Section title="Tests today" aside="Started / finished">
              <dl className="grid grid-cols-2 gap-x-6 gap-y-6 md:grid-cols-4">
                {SKILLS.map((s) => (
                  <Stat key={s} label={<span className="capitalize">{s}</span>} value={`${o.testsToday[s]?.started ?? 0} / ${o.testsToday[s]?.finished ?? 0}`} />
                ))}
              </dl>
            </Section>
          </>
        )}
      </Load>
    </PageContainer>
  );
}
