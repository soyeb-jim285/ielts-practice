import type { SpendAttempt } from '@server/admin/schemas';
import { useSyncExternalStore } from 'react';
import { Badge, Sheet } from '@/components/ui';
import { useAdmin } from '@/lib/admin';
import { dhakaTime, userLabel } from './format';
import { Load } from './Load';
import { stageLabel, usdFine } from './cost';

// The drawer is opened from several pages (Costs, Activity, user detail), so its state is a tiny module store rather than a URL param (route search validators drop unknown keys).
let open: string | null = null;
const subs = new Set<() => void>();
export const openAttempt = (id: string | null) => {
  open = id;
  subs.forEach((f) => f());
};
const useOpen = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => open, () => null);

/** Button-styled-as-link that opens the cost drawer for one attempt. */
export const CostLink = ({ id, usd }: { id: string; usd?: number }) => (
  <button type="button" onClick={() => openAttempt(id)} className="type-num text-accent-text underline-offset-4 hover:underline" aria-label="Show cost breakdown">
    {usd == null ? 'Cost' : usdFine(usd)}
  </button>
);

const detail = (i: SpendAttempt['items'][number]) =>
  [i.inputTokens != null && `${i.inputTokens} in`, i.outputTokens != null && `${i.outputTokens} out`, i.audioSeconds != null && `${i.audioSeconds.toFixed(0)} s`, i.characters != null && `${i.characters} chars`, i.criterion, i.sample != null && `sample ${i.sample}`].filter(Boolean).join(' · ');

/** Stacked bar of one attempt's cost by stage with direct labels for the big ones; the caption names the biggest. */
function Waterfall({ stages, total }: { stages: SpendAttempt['stages']; total: number }) {
  if (total <= 0) return null;
  const tint = ['var(--accent)', 'var(--sky)', 'var(--chart-3)', 'var(--ink)'];
  const big = [...stages].sort((a, b) => b.costUsd - a.costUsd)[0]!;
  return (
    <div className="mt-4">
      <div className="flex h-5 gap-[2px] overflow-hidden rounded-[4px]" role="img" aria-label={`${stageLabel(big.stage)} is ${Math.round((big.costUsd / total) * 100)} percent of the cost`}>
        {stages.map((s, k) => (
          <span key={s.stage} title={`${stageLabel(s.stage)} ${usdFine(s.costUsd)}`} style={{ width: `${(s.costUsd / total) * 100}%`, background: tint[k % tint.length], opacity: 1 - Math.floor(k / tint.length) * 0.4 }} />
        ))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {stages.map((s, k) => (
          <li key={s.stage} className="flex items-center gap-1.5">
            <span aria-hidden className="size-2 rounded-full" style={{ background: tint[k % tint.length] }} />
            {stageLabel(s.stage)} <span className="type-num font-semibold text-ink">{Math.round((s.costUsd / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Body({ d }: { d: SpendAttempt }) {
  const a = d.attempt;
  if (!d.recorded) return <p className="text-sm text-muted">No costs were recorded for this attempt. It ran before cost tracking started.</p>;
  return (
    <>
      <p className="text-sm text-muted">
        <span className="capitalize">{a.skill}</span> part {a.part} · {userLabel({ id: a.userId, email: a.email })} · {dhakaTime(a.createdAt)} · {a.status}
      </p>
      <p className="type-num mt-2 text-3xl font-semibold tracking-tight">{usdFine(d.totalUsd)}</p>
      {d.wasteUsd > 0 && <p className="type-caption">{usdFine(d.wasteUsd)} of it was wasted on failed or repeated calls.</p>}
      {d.sessionTotal && <p className="type-caption">Whole session {usdFine(d.sessionTotal.usd)} across {d.sessionTotal.parts} parts.</p>}
      <Waterfall stages={d.stages} total={d.totalUsd} />
      <ul className="mt-5 divide-y divide-line border-y border-line">
        {d.items.map((i, k) => (
          <li key={k} className="py-2.5">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 font-medium">{stageLabel(i.stage)}</span>
              <span className="type-num shrink-0 font-semibold">{usdFine(i.costUsd)}</span>
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="type-caption min-w-0 truncate" title={i.model}>{i.model.split('/').pop()}</span>
              <span className="type-caption type-num">{detail(i)}</span>
              {i.retry && <Badge tone="warn">retry</Badge>}
              {!i.ok && <Badge tone="bad">failed</Badge>}
              {i.estimated && <Badge title="Priced from the model rate, not the billed amount">estimated</Badge>}
              {i.paidBy === 'own_key' && <Badge tone="info">own key</Badge>}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

/** Right sheet (bottom sheet on a phone) with the line items of one attempt. Mounted once in the admin layout. */
export function AttemptDrawer() {
  const id = useOpen();
  const q = useAdmin<SpendAttempt>(`/spend/attempt/${id ?? 'none'}`, {}, { enabled: !!id });
  return (
    <Sheet open={!!id} onClose={() => openAttempt(null)} title="What this test cost" description={q.data?.attempt.title}>
      {id && <Load q={q} lines={3}>{(d) => <Body d={d} />}</Load>}
    </Sheet>
  );
}
