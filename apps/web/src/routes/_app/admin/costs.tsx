import type { Costs } from '@server/admin/schemas';
import { createFileRoute } from '@tanstack/react-router';
import { dhakaTime, num, usd } from '@/components/admin/format';
import { Load, Section } from '@/components/admin/Load';
import { Alert, Badge, PageContainer, PageHeader, ProgressBar, Stat, type Tone } from '@/components/ui';
import { useAdmin } from '@/lib/admin';

export const Route = createFileRoute('/_app/admin/costs')({ component: CostsPage });

const WARN: Record<Costs['openrouter']['warn'], { tone: Tone; label: string }> = { ok: { tone: 'good', label: 'OK' }, low: { tone: 'warn', label: 'Low' }, critical: { tone: 'bad', label: 'Critical' } };
const Warn = ({ w }: { w: Costs['openrouter']['warn'] }) => <Badge tone={WARN[w].tone}>{WARN[w].label}</Badge>;
const grid = 'grid grid-cols-2 gap-x-6 gap-y-6 md:grid-cols-3';

function CostsPage() {
  const q = useAdmin<Costs>('/costs');
  return (
    <PageContainer>
      <PageHeader title="Costs" description={q.data && `Balances are read from the providers and cached for 5 minutes. Last read ${dhakaTime(q.data.cachedAt)} Dhaka time.`} />
      <Load q={q} lines={4}>
        {(c) => (
          <>
            <Section title="OpenRouter" aside={<Warn w={c.openrouter.warn} />}>
              {c.openrouter.available ? (
                <>
                  <dl className={grid}>
                    <Stat label="Left" value={usd(c.openrouter.remaining)} hint={c.openrouter.limit == null ? 'No spending limit' : `of ${usd(c.openrouter.limit)}`} />
                    <Stat label="Spent" value={usd(c.openrouter.usage)} />
                    <span className="hidden md:block" />
                    <Stat label="Today" value={usd(c.openrouter.usageDaily)} />
                    <Stat label="This week" value={usd(c.openrouter.usageWeekly)} />
                    <Stat label="This month" value={usd(c.openrouter.usageMonthly)} />
                  </dl>
                  {c.openrouter.limit != null && c.openrouter.remaining != null && c.openrouter.limit > 0 && (
                    <ProgressBar className="mt-6 max-w-md" label="OpenRouter balance left" value={c.openrouter.remaining / c.openrouter.limit} tone={WARN[c.openrouter.warn].tone} />
                  )}
                  <p className="type-caption mt-4">Community tests stop when less than {usd(c.minBalance)} is left.</p>
                </>
              ) : (
                <Alert tone="warn">OpenRouter did not answer. Try again in a few minutes.</Alert>
              )}
            </Section>
            <Section title="ElevenLabs (examiner voice)" aside={<Warn w={c.elevenlabs.warn} />}>
              {c.elevenlabs.available ? (
                <>
                  <dl className={grid}>
                    <Stat label="Characters left" value={num(c.elevenlabs.remaining)} hint={`of ${num(c.elevenlabs.characterLimit)}`} />
                    <Stat label="Used" value={num(c.elevenlabs.characterCount)} />
                    <Stat label="Plan" value={<span className="capitalize">{c.elevenlabs.tier ?? '-'}</span>} hint={c.elevenlabs.resetsAt ? `Resets ${dhakaTime(c.elevenlabs.resetsAt)}` : undefined} />
                  </dl>
                  {c.elevenlabs.characterLimit != null && c.elevenlabs.remaining != null && c.elevenlabs.characterLimit > 0 && (
                    <ProgressBar className="mt-6 max-w-md" label="ElevenLabs characters left" value={c.elevenlabs.remaining / c.elevenlabs.characterLimit} tone={WARN[c.elevenlabs.warn].tone} />
                  )}
                </>
              ) : (
                <p className="text-sm text-muted">Not configured, or ElevenLabs did not answer.</p>
              )}
            </Section>
            <Section title="Community pool" aside="Shared key for community tests">
              <dl className={grid}>
                <Stat label="Left" value={usd(c.community.remaining)} />
                <Stat label="Spent" value={usd(c.community.used)} />
                <Stat label="Limit" value={c.community.limit == null ? 'None' : usd(c.community.limit)} />
              </dl>
            </Section>
          </>
        )}
      </Load>
    </PageContainer>
  );
}
