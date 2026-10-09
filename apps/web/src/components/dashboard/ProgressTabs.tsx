import { useState } from 'react';
import { Section } from '@/components/result';
import { BandMeter } from '@/components/result';
import { Card, Tabs, type TabItem } from '@/components/ui';
import { formatBand, plural } from '@/lib/format';
import { cn } from '@/lib/utils';
import { criterionLabel, SPEAKING_CRITERIA, WRITING_CRITERIA } from '@/lib/result';
import type { Progress } from './criteria';
import { LrPanel, type LrData } from './LrInsights';
import { changeSinceFirst } from './overall';
import { useSkillBands } from './YourPicture';
import { BandTrend } from './BandTrend';

type Tab = 'overall' | 'listening' | 'reading' | 'writing' | 'speaking';
const LABEL: Record<Tab, string> = { overall: 'Overall', listening: 'Listening', reading: 'Reading', writing: 'Writing', speaking: 'Speaking' };
const ITEMS: TabItem<Tab>[] = (Object.keys(LABEL) as Tab[]).map((value) => ({ value, label: LABEL[value] }));

/** Skill with the newest scored attempt, so the tab you land on is the one you were just working on. */
export function defaultTab(dates: Partial<Record<Exclude<Tab, 'overall'>, string>>): Tab {
  const best = Object.entries(dates).sort(([, a], [, b]) => b!.localeCompare(a!))[0];
  return (best?.[0] as Tab | undefined) ?? 'overall';
}

/** "+1.0 since your first" in the status tone, or "Same as your first"; null with one attempt. */
export function Change({ bands }: { bands: number[] }) {
  const d = changeSinceFirst(bands);
  if (d == null) return null;
  return (
    <span className={cn('type-caption type-num', d > 0 ? 'text-good-text' : d < 0 ? 'text-bad-text' : '')}>
      {d === 0 ? 'Same as your first' : `${d > 0 ? '+' : '−'}${formatBand(Math.abs(d))} since your first`}
    </span>
  );
}

/** Small multiples, one per criterion: whole-band scores of four criteria overlap as lines on one chart, so each gets its own, on a shared band scale. */
function CriteriaPanel({ skill, trend, target }: { skill: 'speaking' | 'writing'; trend: Progress['trend']; target: number }) {
  const rows = trend.filter((t) => t.skill === skill);
  const keys = skill === 'speaking' ? SPEAKING_CRITERIA : WRITING_CRITERIA;
  const latest = rows.at(-1)?.criteria ?? {};
  if (!rows.length) return <p className="type-lede max-w-[68ch]">Your {skill} criteria appear after your first scored attempt.</p>;
  if (rows.length < 3)
    return (
      <Section title="Band by criterion" level={3} caption={`From your latest ${skill} attempt; the marker is your ${formatBand(target)} target. Each criterion's trend appears after three scored attempts.`}>
        <ul className="grid gap-x-10 gap-y-5 sm:grid-cols-2">
          {keys.map((k) => (
            <li key={k} className="space-y-2">
              <p className="flex items-baseline justify-between gap-4 type-body">
                <span>{criterionLabel(k)}</span>
                <span className="type-band text-3xl">{formatBand(latest[k])}</span>
              </p>
              <BandMeter band={latest[k] ?? 0} target={target} label={`${criterionLabel(k)} band ${formatBand(latest[k])} of 9`} />
            </li>
          ))}
        </ul>
      </Section>
    );
  const all = rows.flatMap((r) => keys.map((k) => r.criteria[k]).filter((v): v is number => v != null));
  const domain: [number, number] = [Math.max(0, Math.floor(Math.min(...all, target)) - 1), 9];
  return (
    <Section title="Band by criterion" level={3} caption={`Your last ${rows.length} ${skill} attempts, oldest on the left. The dashed line is your ${formatBand(target)} target; tap or hover a chart for each score.`}>
      <ul className="grid gap-4 md:grid-cols-2">
        {keys.map((k) => {
          const points = rows.flatMap((r) => (r.criteria[k] == null ? [] : [{ id: r.attemptId, date: r.date, band: r.criteria[k]! }]));
          return (
            <li key={k}>
              <Card className="space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 space-y-1">
                    <h4 className="type-subheading">{criterionLabel(k)}</h4>
                    <Change bands={points.map((p) => p.band)} />
                  </div>
                  <span className="type-band text-3xl">{formatBand(latest[k])}</span>
                </div>
                <BandTrend points={points} target={target} domain={domain} height={120} label={`${criterionLabel(k)} over ${points.length} ${skill} attempts, latest ${formatBand(latest[k])}, target ${formatBand(target)}`} />
              </Card>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

/** Four skill cards: the latest band, a sparkline against the target, the average and how far you have come. */
function OverallPanel({ p, lr, target }: { p: Progress; lr?: LrData; target: number }) {
  const { bands } = useSkillBands(p);
  const points = (k: Exclude<Tab, 'overall'>) =>
    k === 'speaking' || k === 'writing'
      ? p.trend.filter((t) => t.skill === k && t.overall != null).map((t) => ({ id: t.attemptId, date: t.date, band: t.overall as number }))
      : (lr?.trend ?? []).filter((t) => t.skill === k).map((t) => ({ id: t.attemptId, date: t.date, band: t.band }));
  return (
    <ul className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
      {(['listening', 'reading', 'writing', 'speaking'] as const).map((k) => {
        const pts = points(k), latest = pts.at(-1)?.band;
        return (
          <li key={k}>
            <Card className="flex h-full flex-col gap-3">
              <div className="flex items-start justify-between gap-3">
                <h4 className="type-subheading">{LABEL[k]}</h4>
                <span className="type-band text-3xl">{latest == null ? '–' : formatBand(latest)}</span>
              </div>
              {pts.length ? (
                <>
                  <p className="type-caption type-num">
                    Average {bands[k].band == null ? '–' : formatBand(bands[k].band)} · {plural(pts.length, 'attempt')}
                  </p>
                  {pts.length > 1 ? (
                    <BandTrend compact points={pts} target={target} height={48} label={`${LABEL[k]} band over ${pts.length} attempts, latest ${formatBand(latest)}, target ${formatBand(target)}`} />
                  ) : (
                    <BandMeter band={latest ?? 0} target={target} label={`${LABEL[k]} band ${formatBand(latest)} of 9`} />
                  )}
                  <Change bands={pts.map((x) => x.band)} />
                </>
              ) : (
                <p className="type-caption">No scored {LABEL[k].toLowerCase()} test yet.</p>
              )}
            </Card>
          </li>
        );
      })}
    </ul>
  );
}

/** One Progress section, five tabs: the skills side by side, then each skill's trend and what to work on. */
export function ProgressTabs({ p, lr, target }: { p: Progress; lr?: LrData; target: number }) {
  const newest = (skill: 'speaking' | 'writing' | 'listening' | 'reading') => [...p.trend.filter((t) => t.skill === skill), ...(lr?.trend ?? []).filter((t) => t.skill === skill)].map((t) => t.date).sort().at(-1);
  const [tab, setTab] = useState<Tab>(() =>
    defaultTab(Object.fromEntries((['listening', 'reading', 'writing', 'speaking'] as const).flatMap((s) => { const d = newest(s); return d ? [[s, d]] : []; }))),
  );
  return (
    <Section title="Progress" id="progress">
      <Tabs id="progress-tab" items={ITEMS} value={tab} onChange={setTab} />
      <div role="tabpanel" id="progress-tab-panel" aria-labelledby={`progress-tab-${tab}`} className="space-y-6">
        {tab === 'overall' ? <OverallPanel p={p} lr={lr} target={target} /> : tab === 'speaking' || tab === 'writing' ? <CriteriaPanel skill={tab} trend={p.trend} target={target} /> : lr ? <LrPanel skill={tab} data={lr} target={target} /> : null}
      </div>
    </Section>
  );
}
