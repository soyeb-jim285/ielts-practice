import { useState } from 'react';
import CriteriaTrend from '@/components/dashboard/Charts';
import { Section, StatList } from '@/components/result';
import { BandMeter } from '@/components/result';
import { Tabs, type TabItem } from '@/components/ui';
import { formatBand } from '@/lib/format';
import { criterionLabel, SPEAKING_CRITERIA, WRITING_CRITERIA } from '@/lib/result';
import type { Progress } from './criteria';
import { LrPanel, type LrData } from './LrInsights';
import { changeSinceFirst } from './overall';
import { useSkillBands } from './YourPicture';

type Tab = 'overall' | 'listening' | 'reading' | 'writing' | 'speaking';
const LABEL: Record<Tab, string> = { overall: 'Overall', listening: 'Listening', reading: 'Reading', writing: 'Writing', speaking: 'Speaking' };
const ITEMS: TabItem<Tab>[] = (Object.keys(LABEL) as Tab[]).map((value) => ({ value, label: LABEL[value] }));

/** Skill with the newest scored attempt, so the tab you land on is the one you were just working on. */
export function defaultTab(dates: Partial<Record<Exclude<Tab, 'overall'>, string>>): Tab {
  const best = Object.entries(dates).sort(([, a], [, b]) => b!.localeCompare(a!))[0];
  return (best?.[0] as Tab | undefined) ?? 'overall';
}

function CriteriaPanel({ skill, trend, target }: { skill: 'speaking' | 'writing'; trend: Progress['trend']; target: number }) {
  const rows = trend.filter((t) => t.skill === skill);
  const keys = skill === 'speaking' ? SPEAKING_CRITERIA : WRITING_CRITERIA;
  const latest = rows.at(-1)?.criteria ?? {};
  if (!rows.length) return <p className="type-lede max-w-[68ch]">Your {skill} criteria appear after your first scored attempt.</p>;
  return (
    <Section title="Band by criterion" level={3} caption={rows.length < 3 ? `From your latest ${skill} attempt; the marker is your ${formatBand(target)} target. The trend line appears after three scored attempts.` : `Your last ${rows.length} ${skill} attempts, oldest first; the dashed line is your ${formatBand(target)} target.`}>
      {rows.length < 3 ? (
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
      ) : (
        <>
          <CriteriaTrend trend={rows} keys={keys} target={target} />
          <StatList cols={2} numeral items={keys.map((k) => ({ label: `${criterionLabel(k)}, latest`, value: latest[k] ?? 0 }))} />
        </>
      )}
    </Section>
  );
}

function OverallPanel({ p, lr }: { p: Progress; lr?: LrData }) {
  const { bands } = useSkillBands(p);
  const series = (s: 'speaking' | 'writing') => p.trend.filter((t) => t.skill === s && t.overall != null).map((t) => t.overall as number);
  const lrSeries = (s: 'listening' | 'reading') => (lr?.trend ?? []).filter((t) => t.skill === s).map((t) => t.band);
  const rows = (['listening', 'reading', 'writing', 'speaking'] as const).map((k) => {
    const all = k === 'speaking' || k === 'writing' ? series(k) : lrSeries(k);
    return { k, latest: all.at(-1) ?? null, avg: bands[k].band, n: all.length, change: changeSinceFirst(all) };
  });
  const f = (v: number | null) => (v == null ? '-' : formatBand(v));
  return (
    <table className="w-full max-w-[68ch] border-collapse type-body type-num">
      <caption className="sr-only">Band by skill</caption>
      <thead>
        <tr className="type-caption border-b border-line text-left">
          <th scope="col" className="py-2 pr-3 font-normal">Skill</th>
          <th scope="col" className="py-2 pr-3 text-right font-normal">Latest</th>
          <th scope="col" className="py-2 pr-3 text-right font-normal">Average</th>
          <th scope="col" className="py-2 pr-3 text-right font-normal">Attempts</th>
          <th scope="col" className="py-2 text-right font-normal">Since first</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {rows.map((r) => (
          <tr key={r.k}>
            <th scope="row" className="py-3 pr-3 text-left type-subheading">{LABEL[r.k]}</th>
            <td className="py-3 pr-3 text-right">{f(r.latest)}</td>
            <td className="py-3 pr-3 text-right">{f(r.avg)}</td>
            <td className="py-3 pr-3 text-right">{r.n || '-'}</td>
            <td className="py-3 text-right">{r.change == null ? '-' : r.change === 0 ? 'Same' : `${r.change > 0 ? '+' : '-'}${formatBand(Math.abs(r.change))}`}</td>
          </tr>
        ))}
      </tbody>
    </table>
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
        {tab === 'overall' ? <OverallPanel p={p} lr={lr} /> : tab === 'speaking' || tab === 'writing' ? <CriteriaPanel skill={tab} trend={p.trend} target={target} /> : lr ? <LrPanel skill={tab} data={lr} target={target} /> : null}
      </div>
    </Section>
  );
}
