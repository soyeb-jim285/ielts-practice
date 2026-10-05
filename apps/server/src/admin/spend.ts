// AI spend from the `ai_costs` ledger (docs/admin/COSTS-AND-UI.md section 5). Owner only; numbers and whitelisted flags only, never raw meta.
import { createRoute, z } from '@hono/zod-openapi';
import { sql, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db/client';
import { env } from '../env';
import type { App } from '../types';
import { adminRoute as readonlyRoute, dhakaTodayStart, daysAgo } from './common';
import { getCosts, houseBurn } from './costs';
import { SpendAttempt, SpendBy, SpendDim, SpendForecast, SpendQuery, SpendSeries, SpendSummary, SpendWaste } from './schemas';

const adminRoute = { ...readonlyRoute, middleware: [...readonlyRoute.middleware] }; // ponytail: common.ts declares the tuple `as const`, which createRoute rejects
const json = <T extends z.ZodType>(schema: T, description: string) => ({ description, content: { 'application/json': { schema } } });
const ErrorSchema = z.object({ error: z.string() });

const rows = async <T>(q: SQL) => [...(await db.execute(q))] as unknown as T[];
const r6 = (n: number | string | null | undefined) => Math.round(Number(n ?? 0) * 1e6) / 1e6;
const num = (n: number | string | null | undefined) => Number(n ?? 0);
const since = (days: number) => daysAgo(days - 1); // "last n days" = the n Dhaka calendar days ending today
const paid = (p: 'house' | 'own_key' | 'all', col = sql`c.paid_by`) => (p === 'all' ? sql`true` : sql`${col} = ${p}`);
const iso = (col: SQL | string) => sql<string>`to_char(${typeof col === 'string' ? sql.raw(col) : col} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

/** A call that produced nothing (or a second charge for the same result). One category per row, in this order. */
const KIND = sql`case
  when not c.ok then 'failed'
  when c.retry then 'retry'
  when c.stage = 'stt_verbatim' and c.meta->>'kept' = 'false' then 'discarded_stt'
  when c.meta->>'extra' = 'true' then 'extra_samples'
  when a.status = 'failed' or exists (select 1 from quota_usage q where q.user_id = c.user_id and q.refunded_at is not null and q.unit_key in (c.attempt_id, c.session_id)) then 'failed_attempt'
  end`;
const WASTE_JOIN = sql`left join attempts a on a.id = c.attempt_id`;

async function waste(days: number, pb: 'house' | 'own_key' | 'all') {
  const [parts, [t]] = await Promise.all([
    rows<{ kind: SpendWasteKind; usd: string; calls: string }>(sql`select kind, sum(usd) as usd, sum(calls) as calls from (select ${KIND} as kind, c.cost_usd as usd, 1 as calls from ai_costs c ${WASTE_JOIN} where c.created_at >= ${since(days)} and ${paid(pb)}) w where kind is not null group by kind`),
    rows<{ usd: string }>(sql`select coalesce(sum(c.cost_usd), 0) as usd from ai_costs c where c.created_at >= ${since(days)} and ${paid(pb)}`),
  ]);
  const totalUsd = r6(parts.reduce((s, p) => s + num(p.usd), 0)), spendUsd = r6(t!.usd);
  return { totalUsd, spendUsd, share: spendUsd > 0 ? totalUsd / spendUsd : 0, parts: parts.map((p) => ({ kind: p.kind, usd: r6(p.usd), calls: Number(p.calls) })) };
}
type SpendWasteKind = z.infer<typeof SpendWaste>['parts'][number]['kind'];

export function register(app: App) {
  const q = { query: SpendQuery };

  app.openapi(
    createRoute({ ...adminRoute, method: 'get', path: '/api/admin/spend/summary', summary: 'Spend totals (today / 7 d / 30 d / all time, house vs own key), waste, cost per finished attempt and the drift against OpenRouter\'s own usage', request: q, responses: { 200: json(SpendSummary, 'Summary') } }),
    async (c) => {
      const { days, paidBy } = c.req.valid('query');
      const W = { today: dhakaTodayStart, last7d: daysAgo(6), last30d: daysAgo(29), allTime: sql`'-infinity'::timestamptz` };
      const cols = Object.entries(W).flatMap(([k, from]) =>
        (['house', 'own_key'] as const).flatMap((p) => [
          sql`coalesce(sum(cost_usd) filter (where paid_by = ${p} and created_at >= ${from}), 0) as ${sql.raw(`${k}_${p}`)}`,
          sql`count(*) filter (where paid_by = ${p} and created_at >= ${from}) as ${sql.raw(`${k}_${p}_n`)}`,
        ]),
      );
      const [[t], [ok], per, [unrec], [rec], w, costs] = await Promise.all([
        rows<Record<string, string>>(sql`select ${sql.join(cols, sql`, `)}, min(created_at) as first from ai_costs`),
        rows<{ n: string; ok: string }>(sql`select count(*) as n, count(*) filter (where ok) as ok from ai_costs where created_at >= ${daysAgo(29)}`),
        rows<{ skill: 'speaking' | 'writing'; part: number; n: string; avg: string; med: string; p90: string; waste: string }>(sql`
          select a.skill::text as skill, a.part, count(*) as n, avg(t.total) as avg, percentile_cont(0.5) within group (order by t.total) as med,
            percentile_cont(0.9) within group (order by t.total) as p90, avg(t.waste) as waste
          from attempts a join (
            select c.attempt_id, sum(c.cost_usd) as total, coalesce(sum(c.cost_usd) filter (where ${KIND} is not null), 0) as waste
            from ai_costs c ${WASTE_JOIN} where c.attempt_id is not null and ${paid(paidBy)} group by c.attempt_id
          ) t on t.attempt_id = a.id
          where a.status = 'done' and a.created_at >= ${since(days)} group by 1, 2 order by 1 desc, 2`),
        rows<{ n: string }>(sql`select count(*) as n from attempts a where a.status = 'done' and a.created_at >= ${since(days)} and not exists (select 1 from ai_costs c where c.attempt_id = a.id)`),
        rows<{ day: string; week: string; month: string }>(sql`select
          coalesce(sum(cost_usd) filter (where created_at >= ${dhakaTodayStart}), 0) as day, coalesce(sum(cost_usd) filter (where created_at >= ${daysAgo(6)}), 0) as week, coalesce(sum(cost_usd), 0) as month
          from ai_costs where provider = 'openrouter' and paid_by = 'house' and created_at >= ${daysAgo(29)}`),
        waste(days, paidBy),
        getCosts(),
      ]);
      const tot = (key: string) => (({ k }) => ({ house: r6(t![`${k}_house`]), ownKey: r6(t![`${k}_own_key`]), calls: Number(t![`${k}_house_n`]) + Number(t![`${k}_own_key_n`]) }))({ k: key.toLowerCase() }); // unquoted aliases fold to lower case
      const or = costs.openrouter;
      const week = r6(rec!.week);
      return c.json(
        {
          since: t!.first ? new Date(t!.first).toISOString() : null,
          today: tot('today'), last7d: tot('last7d'), last30d: tot('last30d'), allTime: tot('allTime'),
          okRate: Number(ok!.n) ? Number(ok!.ok) / Number(ok!.n) : null,
          waste: { usd: w.totalUsd, share: w.share },
          perAttempt: per.map((p) => ({ skill: p.skill, part: p.part, n: Number(p.n), avgUsd: r6(p.avg), medianUsd: r6(p.med), p90Usd: r6(p.p90), wasteUsd: r6(p.waste) })),
          unrecordedAttempts: Number(unrec!.n),
          drift: {
            recorded: { day: r6(rec!.day), week, month: r6(rec!.month) },
            openrouter: { day: or.usageDaily, week: or.usageWeekly, month: or.usageMonthly },
            warn: !!t!.first && Date.now() - new Date(t!.first).getTime() >= 7 * 86_400_000 && or.usageWeekly != null && Math.max(week, or.usageWeekly) > 0.01 && Math.abs(week - or.usageWeekly) / Math.max(week, or.usageWeekly) > 0.05,
          },
        },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      ...adminRoute, method: 'get', path: '/api/admin/spend/series', summary: 'Spend per Dhaka day / week / month, house vs own key',
      request: { query: z.object({ bucket: z.enum(['day', 'week', 'month']).default('day') }).extend(SpendQuery.shape) },
      responses: { 200: json(SpendSeries, 'Series') },
    }),
    async (c) => {
      const { bucket, days } = c.req.valid('query');
      const b = sql.raw(`'${bucket}'`); // enum-validated
      const d = sql`to_char(date_trunc(${b}, created_at at time zone 'Asia/Dhaka'), 'YYYY-MM-DD')`;
      const r = await rows<{ d: string; house: string; own: string; n: string }>(sql`select ${d} as d, coalesce(sum(cost_usd) filter (where paid_by = 'house'), 0) as house, coalesce(sum(cost_usd) filter (where paid_by = 'own_key'), 0) as own, count(*) as n
        from ai_costs where created_at >= ${since(days)} group by 1 order by 1`);
      return c.json({ bucket, points: r.map((x) => ({ date: x.d, house: r6(x.house), ownKey: r6(x.own), calls: Number(x.n) })) }, 200);
    },
  );

  const DIMS: Record<z.infer<typeof SpendDim>, { key: SQL; label: SQL; join?: SQL }> = {
    stage: { key: sql`c.stage`, label: sql`c.stage` },
    model: { key: sql`c.model`, label: sql`c.model` },
    provider: { key: sql`c.provider`, label: sql`c.provider` },
    skill_part: { key: sql`coalesce(c.skill, 'live') || ' ' || coalesce(c.part::text, '')`, label: sql`coalesce(c.skill, 'live') || coalesce(' part ' || c.part::text, '')` },
    user: { key: sql`coalesce(c.user_id, '')`, label: sql`coalesce(case when u.is_anonymous then 'Guest ' || left(u.id, 6) else u.email end, 'Unknown')`, join: sql`left join "user" u on u.id = c.user_id` },
    prompt: { key: sql`coalesce(c.prompt_id, '')`, label: sql`coalesce(p.title, 'Unknown')`, join: sql`left join prompts p on p.id = c.prompt_id` },
  };
  app.openapi(
    createRoute({
      ...adminRoute, method: 'get', path: '/api/admin/spend/by', summary: 'Spend ranked by stage, model, provider, skill+part, user or prompt (test)',
      request: { query: z.object({ dim: SpendDim, limit: z.coerce.number().int().min(1).max(100).default(20) }).extend(SpendQuery.shape) },
      responses: { 200: json(SpendBy, 'Ranking') },
    }),
    async (c) => {
      const { dim, limit, days, paidBy } = c.req.valid('query');
      const D = DIMS[dim];
      const r = await rows<{ k: string; label: string; cost: string; calls: string; attempts: string; total: string }>(sql`
        select ${D.key} as k, ${D.label} as label, sum(c.cost_usd) as cost, count(*) as calls, count(distinct c.attempt_id) as attempts, sum(sum(c.cost_usd)) over () as total
        from ai_costs c ${D.join ?? sql``} where c.created_at >= ${since(days)} and ${paid(paidBy)} group by 1, 2 order by cost desc, k limit ${limit}`);
      const total = num(r[0]?.total);
      return c.json({ dim, total: r6(total), items: r.map((x) => ({ key: x.k, label: x.label, costUsd: r6(x.cost), calls: Number(x.calls), attempts: Number(x.attempts), avgPerCall: r6(num(x.cost) / Number(x.calls)), share: total > 0 ? num(x.cost) / total : 0 })) }, 200);
    },
  );

  app.openapi(
    createRoute({
      ...adminRoute, method: 'get', path: '/api/admin/spend/attempt/{id}', summary: 'Line items, per-stage subtotals, waste and session total of one attempt',
      request: { params: z.object({ id: z.string().openapi({ param: { name: 'id', in: 'path' } }) }) },
      responses: { 200: json(SpendAttempt, 'Cost of an attempt'), 404: json(ErrorSchema, 'Not found') },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const [a] = await rows<{ id: string; skill: 'speaking' | 'writing'; part: number; status: string; at: string; session_id: string | null; user_id: string; email: string; guest: boolean; title: string }>(sql`
        select a.id, a.skill::text as skill, a.part, a.status::text as status, ${iso('a.created_at')} as at, a.session_id, a.user_id, u.email, coalesce(u.is_anonymous, false) as guest, p.title
        from attempts a join "user" u on u.id = a.user_id join prompts p on p.id = a.prompt_id where a.id = ${id}`);
      if (!a) throw new HTTPException(404, { message: 'Attempt not found' });
      const [items, [sess]] = await Promise.all([
        rows<{ at: string; stage: string; provider: string; model: string; paid_by: 'house' | 'own_key'; input_tokens: number | null; output_tokens: number | null; audio_seconds: string | null; characters: number | null; cost: string; ok: boolean; retry: boolean; w: boolean; meta: Record<string, unknown> | null }>(sql`
          select ${iso('c.created_at')} as at, c.stage, c.provider, c.model, c.paid_by, c.input_tokens, c.output_tokens, c.audio_seconds, c.characters, c.cost_usd as cost, c.ok, c.retry, ${KIND} is not null as w, c.meta
          from ai_costs c ${WASTE_JOIN} where c.attempt_id = ${id} order by c.created_at, c.id`),
        a.session_id ? rows<{ usd: string; parts: string }>(sql`select coalesce(sum(cost_usd), 0) as usd, count(distinct attempt_id) as parts from ai_costs where session_id = ${a.session_id}`) : Promise.resolve([undefined]),
      ]);
      const stages = new Map<string, { costUsd: number; calls: number }>();
      for (const i of items) {
        const s = stages.get(i.stage) ?? { costUsd: 0, calls: 0 };
        stages.set(i.stage, { costUsd: s.costUsd + num(i.cost), calls: s.calls + 1 });
      }
      return c.json(
        {
          attempt: { id: a.id, skill: a.skill, part: a.part, status: a.status, createdAt: a.at, userId: a.user_id, email: a.guest ? '' : a.email, isGuest: a.guest, title: a.title },
          recorded: items.length > 0,
          items: items.map((i) => ({
            at: i.at, stage: i.stage, provider: i.provider, model: i.model, paidBy: i.paid_by, inputTokens: i.input_tokens, outputTokens: i.output_tokens, audioSeconds: i.audio_seconds == null ? null : num(i.audio_seconds), characters: i.characters,
            costUsd: r6(i.cost), ok: i.ok, retry: i.retry,
            estimated: i.meta?.estimated === true, criterion: typeof i.meta?.criterion === 'string' ? i.meta.criterion : null, sample: typeof i.meta?.sample === 'number' ? i.meta.sample : null,
            extra: i.meta?.extra === true, kept: typeof i.meta?.kept === 'boolean' ? i.meta.kept : null, timeout: i.meta?.timeout === true,
          })),
          stages: [...stages].map(([stage, s]) => ({ stage, costUsd: r6(s.costUsd), calls: s.calls })),
          totalUsd: r6(items.reduce((s, i) => s + num(i.cost), 0)),
          wasteUsd: r6(items.filter((i) => i.w).reduce((s, i) => s + num(i.cost), 0)),
          sessionTotal: sess ? { usd: r6(sess.usd), parts: Number(sess.parts) } : null,
        },
        200,
      );
    },
  );

  app.openapi(
    createRoute({ ...adminRoute, method: 'get', path: '/api/admin/spend/waste', summary: 'Spend on failed calls, retries, discarded primed transcriptions, extra scoring samples and failed or refunded attempts', request: q, responses: { 200: json(SpendWaste, 'Waste') } }),
    async (c) => {
      const { days, paidBy } = c.req.valid('query');
      return c.json(await waste(days, paidBy), 200);
    },
  );

  app.openapi(
    createRoute({ ...adminRoute, method: 'get', path: '/api/admin/spend/forecast', summary: 'Days of OpenRouter balance left at the 7-day house burn rate, and finished tests left above the community floor', responses: { 200: json(SpendForecast, 'Forecast') } }),
    async (c) => {
      const [costs, burn, [avg]] = await Promise.all([
        getCosts(),
        houseBurn(),
        rows<{ avg: string | null }>(sql`select avg(t.total) as avg from (select sum(c.cost_usd) as total from ai_costs c join attempts a on a.id = c.attempt_id where c.paid_by = 'house' and a.status = 'done' and a.created_at >= ${daysAgo(29)} group by coalesce(a.session_id, a.id)) t`),
      ]);
      const remaining = costs.openrouter.remaining;
      const daysLeft = remaining != null && burn.p7 ? remaining / burn.p7 : null;
      const usableLeft = remaining != null ? Math.max(0, remaining - env.COMMUNITY_MIN_BALANCE) : null;
      const avgCost = avg!.avg == null ? null : r6(avg!.avg);
      const out = daysLeft == null ? null : new Date(Date.now() + daysLeft * 86_400_000);
      return c.json(
        {
          remaining,
          burnPerDay7d: burn.p7 == null ? null : r6(burn.p7),
          burnPerDay14d: burn.p14 == null ? null : r6(burn.p14),
          daysLeft: daysLeft == null ? null : Math.round(daysLeft * 10) / 10,
          runsOutOn: out ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(out) : null,
          usableLeft,
          avgCostPerTest: avgCost,
          testsLeft: usableLeft != null && avgCost ? Math.floor(usableLeft / avgCost) : null,
          status: daysLeft == null ? ('unknown' as const) : daysLeft < 3 ? ('critical' as const) : daysLeft < 7 ? ('low' as const) : ('ok' as const),
        },
        200,
      );
    },
  );
}
