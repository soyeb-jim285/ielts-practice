import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Button, ProgressBar, type Tone } from '@/components/ui';
import { call, client, type Schemas } from '@/lib/api';
import { formatBand, formatDate } from '@/lib/format';
import { lrProgressQuery } from '@/lib/lr';
import { cn } from '@/lib/utils';

type Trend = Schemas['LrProgress']['trend'];
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

/** Dashboard section for Listening & Reading: band trends, accuracy of your weakest question types, and a test to practise them on. */
export function LrInsights({ target }: { target: number }) {
  const { data } = useQuery(lrProgressQuery);
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  if (!data || !data.trend.length) return null;
  const start = async (id: string) => {
    setBusy(true);
    try {
      const a = await call(client.POST('/api/lr/tests/{id}/attempts', { params: { path: { id } }, body: { mode: 'practice' } }));
      await navigate({ to: '/lr/run/$attemptId', params: { attemptId: a.id } });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-labelledby="lr-h" className="border-t border-line pt-8">
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-x-6">
        <h2 id="lr-h" className="type-heading">Listening and Reading</h2>
        <Link to="/history" search={{ skill: 'listening' }} className="type-caption underline decoration-line underline-offset-4 hover:text-accent-text">All results</Link>
      </div>
      <div className="grid gap-x-12 gap-y-8 lg:grid-cols-2">
        <div className="space-y-5">
          {(['listening', 'reading'] as const).map((k) => {
            const rows = data.trend.filter((t) => t.skill === k);
            if (!rows.length) return null;
            const last = rows.at(-1)!;
            return (
              <div key={k} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
                <div>
                  <p className="type-caption">{SKILL[k]}, latest of {rows.length}</p>
                  <p className="type-band text-4xl">{formatBand(last.band)}</p>
                  {rows.length > 1 && (
                    <p className="type-caption type-num">
                      {rows[0]!.band === last.band ? 'Same as your first' : `${last.band > rows[0]!.band ? 'Up' : 'Down'} ${formatBand(Math.abs(last.band - rows[0]!.band))} from your first`}
                      <span className="sr-only">. </span>
                    </p>
                  )}
                </div>
                <Spark rows={rows} target={target} label={`${SKILL[k]} band over ${rows.length} attempts, latest ${formatBand(last.band)}; dashed line is your ${formatBand(target)} target`} />
              </div>
            );
          })}
        </div>
        <div>
          <h3 className="type-subheading mb-2">Weakest question types</h3>
          {data.weakest.length ? (
            <ul className="divide-y divide-line border-y border-line">
              {data.weakest.map((w) => {
                const r = w.right / w.total;
                return (
                  <li key={`${w.skill}-${w.label}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 py-3">
                    <span className="min-w-0 type-body">{w.label} <span className="type-caption">({SKILL[w.skill]})</span></span>
                    <span className={cn('type-num text-sm font-semibold', r < 0.5 ? 'text-bad-text' : 'text-warn-text')}>{Math.round(r * 100)}%</span>
                    <ProgressBar label={`${w.label}: ${w.right} of ${w.total} correct`} value={r} tone={tone(r)} className="col-span-2 h-1.5" />
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="type-lede">Your weak spots appear after a few more answered questions.</p>
          )}
          {data.suggested && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-card px-4 py-3">
              <p className="type-body min-w-0">
                <span className="type-caption block">Suggested next test</span>
                {data.suggested.title} <span className="type-caption">has {data.suggested.count} {data.suggested.label.toLowerCase()} questions</span>
              </p>
              <Button size="sm" loading={busy} onClick={() => void start(data.suggested!.id)}>Practise</Button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
