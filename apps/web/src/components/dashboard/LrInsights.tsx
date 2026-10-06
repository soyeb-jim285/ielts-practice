import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Button, ProgressBar, type Tone } from '@/components/ui';
import { Section } from '@/components/result';
import { call, client, type Schemas } from '@/lib/api';
import { formatBand, formatDate } from '@/lib/format';
import { changeSinceFirst } from './overall';
import { cn } from '@/lib/utils';

type Trend = Schemas['LrProgress']['trend'];
export type LrData = Schemas['LrProgress'];
const SKILL = { listening: 'Listening', reading: 'Reading' } as const;
const tone = (r: number): Tone => (r >= 0.75 ? 'good' : r >= 0.5 ? 'warn' : 'bad');

/** Band per attempt as a small line: fixed viewBox, scales with its container; the table-less summary sits beside it. */
function Spark({ rows, target, label }: { rows: Trend; target: number; label: string }) {
  const W = 220, H = 56, P = 4;
  const x = (i: number) => (rows.length < 2 ? W / 2 : P + (i * (W - 2 * P)) / (rows.length - 1));
  const y = (b: number) => H - P - (Math.min(9, Math.max(0, b)) / 9) * (H - 2 * P);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="h-14 w-full max-w-[16rem] overflow-visible">
      <line x1={0} x2={W} y1={y(target)} y2={y(target)} stroke="var(--line-strong)" strokeDasharray="3 4" />
      {rows.length > 1 && <polyline fill="none" stroke="var(--accent)" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" points={rows.map((r, i) => `${x(i)},${y(r.band)}`).join(' ')} />}
      {rows.map((r, i) => (
        <circle key={r.attemptId} cx={x(i)} cy={y(r.band)} r={i === rows.length - 1 ? 4 : 2.5} fill="var(--accent)">
          <title>{`${formatDate(r.date)}: band ${formatBand(r.band)}`}</title>
        </circle>
      ))}
    </svg>
  );
}

/** Starts a practice attempt on one Listening or Reading test; `busy` is true while it is created. */
export function useStartLr() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const start = async (id: string) => {
    setBusy(true);
    try {
      const a = await call(client.POST('/api/lr/tests/{id}/attempts', { params: { path: { id } }, body: { mode: 'practice' } }));
      await navigate({ to: '/lr/run/$attemptId', params: { attemptId: a.id } });
    } finally {
      setBusy(false);
    }
  };
  return { start, busy };
}

/** Progress tab for Listening or Reading: the band over attempts, accuracy on your weakest question types of this skill, and one test to practise them on. */
export function LrPanel({ skill, data, target }: { skill: 'listening' | 'reading'; data: LrData; target: number }) {
  const { start, busy } = useStartLr();
  const rows = data.trend.filter((t) => t.skill === skill);
  const last = rows.at(-1);
  const change = changeSinceFirst(rows.map((r) => r.band));
  const weakest = data.weakest.filter((w) => w.skill === skill);
  const suggested = data.suggested?.skill === skill ? data.suggested : null;
  return (
    <div className="grid gap-x-12 gap-y-8 lg:grid-cols-2">
      <div className="space-y-4">
        {last ? (
          <>
            <p className="type-caption type-num">{SKILL[skill]}, latest of {rows.length}</p>
            <p className="type-band text-3xl">{formatBand(last.band)}</p>
            {change != null && (
              <p className="type-body type-num">
                {change === 0 ? 'Same as your first' : `${change > 0 ? 'Up' : 'Down'} ${formatBand(Math.abs(change))} from your first`}
                <span className="sr-only">. </span>
              </p>
            )}
            <Spark rows={rows} target={target} label={`${SKILL[skill]} band over ${rows.length} attempts, latest ${formatBand(last.band)}; dashed line is your ${formatBand(target)} target`} />
          </>
        ) : (
          <p className="type-lede max-w-[68ch]">Your {SKILL[skill]} band trend appears after your first scored whole test.</p>
        )}
      </div>
      <div>
        <Section title="Weakest question types" level={3}>
          {weakest.length ? (
            <ul className="divide-y divide-line border-y border-line">
              {weakest.map((w) => {
                const r = w.right / w.total;
                return (
                  <li key={w.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 py-3">
                    <span className="min-w-0 type-body">{w.label}</span>
                    <span className={cn('type-body type-num', r < 0.5 ? 'text-bad-text' : 'text-warn-text')}>{Math.round(r * 100)}%</span>
                    <ProgressBar label={`${w.label}: ${w.right} of ${w.total} correct`} value={r} tone={tone(r)} className="col-span-2 h-1.5" />
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="type-lede max-w-[68ch]">Your weak spots appear after a few more answered questions.</p>
          )}
          {suggested && (
            <p className="type-body flex flex-wrap items-center gap-x-4 gap-y-2">
              <span className="min-w-0">
                <span className="type-caption block">Suggested next test</span>
                {suggested.title} <span className="type-caption">has {suggested.count} {suggested.label.toLowerCase()} questions</span>
              </span>
              <Button size="sm" loading={busy} onClick={() => void start(suggested.id)}>Practise</Button>
            </p>
          )}
        </Section>
      </div>
    </div>
  );
}
