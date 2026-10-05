import { createRoute, z, type RouteConfig } from '@hono/zod-openapi';
import { speakingLines } from '@ielts/core';
import { and, count, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { renderedHashes, speakingAudioHash } from '../ai/speaking-audio';
import { cambridgeSource, requireOwner } from '../auth';
import { db } from '../db/client';
import { feedback, lrAttempts, lrTests, prompts, replaySessions, user as userT } from '../db/schema';
import { storage } from '../storage';
import type { App } from '../types';
import { ACTIVITY, daysAgo, dhakaDay, pageQuery } from './common';
import {
  ActivityItem, ActivityPage, Content, Funnel, Growth, Missed, Overview, SkillS, Tests, UserDetail, UsersPage,
  type CambridgeInfo, type ReplayItem, type Skill, type TestHealth, type UserRow,
} from './schemas';

// "Last n days" everywhere = the n Dhaka calendar days ending today, so the window starts at daysAgo(n - 1).
const since = (n: number) => daysAgo(n - 1);
/** Timestamp column as an ISO-8601 UTC string (raw db.execute rows hand timestamps back as driver strings). */
const iso = (col: SQL | string) => sql<string>`to_char(${typeof col === 'string' ? sql.raw(col) : col} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
const rows = async <T>(q: SQL) => [...(await db.execute(q))] as unknown as T[];
const ids = (list: string[]) => sql.join(list.map((i) => sql`${i}`), sql`, `);
const like = (q: string) => `%${q.replace(/[\\%_]/g, '\\$&')}%`;
const r2 = (x: number | string | null) => (x === null ? null : Math.round(Number(x) * 100) / 100);
const SKILLS = ['speaking', 'writing', 'listening', 'reading'] as const;

const cambridgeInfo = (email: string, verified: boolean, guest: boolean): CambridgeInfo => {
  const source = guest ? null : cambridgeSource(email);
  return { allowed: verified && source !== null, source, canToggle: !guest && (source === null || source === 'granted') };
};

// ---------- activity feed: attempts and L/R attempts as one stream ----------
const feedSql = sql`(
  select 'attempt' as kind, a.id, a.user_id, u.email, coalesce(u.is_anonymous, false) as guest, a.skill::text as skill, p.title, a.mode::text as mode,
    a.part, null::jsonb as lr_parts, an.overall as score, null::int as raw, null::int as total, a.status::text as status, a.created_at as at
  from attempts a join prompts p on p.id = a.prompt_id join "user" u on u.id = a.user_id left join analyses an on an.attempt_id = a.id
  union all
  select 'lr', l.id, l.user_id, u.email, coalesce(u.is_anonymous, false), t.skill, t.title, l.mode, null, l.parts, l.band, l.raw, l.total, l.status, l.started_at
  from lr_attempts l join lr_tests t on t.id = l.test_id join "user" u on u.id = l.user_id
) f`;

type FeedRow = { kind: 'attempt' | 'lr'; id: string; user_id: string; email: string; guest: boolean; skill: Skill; title: string; mode: ActivityItem['mode']; part: number | null; lr_parts: number[] | null; score: string | number | null; raw: number | null; total: number | null; status: ActivityItem['status']; at: string };

async function feed(filters: SQL[], limit: number, offset = 0): Promise<{ items: ActivityItem[]; total: number }> {
  const where = filters.length ? sql.join(filters, sql` and `) : sql`true`;
  const [[c], page] = await Promise.all([
    rows<{ n: string }>(sql`select count(*) as n from ${feedSql} where ${where}`),
    rows<FeedRow>(sql`select f.kind, f.id, f.user_id, f.email, f.guest, f.skill, f.title, f.mode, f.part, f.lr_parts, f.score, f.raw, f.total, f.status, ${iso('f.at')} as at from ${feedSql} where ${where} order by f.at desc, f.id limit ${limit} offset ${offset}`),
  ]);
  // replay sessions whose [start - 5 min, last + 5 min] covers the attempt
  const uids = [...new Set(page.map((r) => r.user_id))];
  const sessions = uids.length ? await db.select({ id: replaySessions.id, userId: replaySessions.userId, startedAt: replaySessions.startedAt, lastAt: replaySessions.lastAt }).from(replaySessions).where(inArray(replaySessions.userId, uids)).orderBy(desc(replaySessions.startedAt)) : [];
  const slack = 5 * 60_000;
  const items = page.map((r): ActivityItem => {
    const at = new Date(r.at).getTime();
    return {
      id: r.id,
      kind: r.kind,
      userId: r.user_id,
      email: r.guest ? '' : r.email,
      isGuest: r.guest,
      skill: r.skill,
      title: r.title,
      mode: r.mode,
      parts: r.kind === 'attempt' ? `${r.skill === 'writing' ? 'Task' : 'Part'} ${r.part}` : r.lr_parts?.length ? `${r.lr_parts.length > 1 ? 'Parts' : 'Part'} ${r.lr_parts.join(', ')}` : 'All',
      score: r2(r.score),
      raw: r.raw !== null && r.total !== null ? { raw: r.raw, total: r.total } : null,
      status: r.status,
      startedAt: r.at,
      resultPath: r.kind === 'attempt' ? `/${r.skill}/result/${r.id}` : r.status === 'in_progress' ? `/lr/run/${r.id}` : `/lr/result/${r.id}`,
      replays: sessions.filter((s) => s.userId === r.user_id && s.startedAt.getTime() - slack <= at && at <= s.lastAt.getTime() + slack).slice(0, 3).map((s) => ({ id: s.id, startedAt: s.startedAt.toISOString() })),
    };
  });
  return { items, total: Number(c!.n) };
}

// ---------- users ----------
async function userRows(list: string[]): Promise<UserRow[]> {
  if (!list.length) return [];
  const inList = ids(list);
  const [users, counts, replayCounts, active] = await Promise.all([
    db.select().from(userT).where(inArray(userT.id, list)),
    rows<{ user_id: string; skill: Skill; n: string }>(sql`select user_id, skill, count(*) as n from (
      select user_id, skill::text as skill from attempts where user_id in (${inList})
      union all select l.user_id, t.skill from lr_attempts l join lr_tests t on t.id = l.test_id where l.user_id in (${inList})) x group by 1, 2`),
    db.select({ userId: replaySessions.userId, n: count() }).from(replaySessions).where(inArray(replaySessions.userId, list)).groupBy(replaySessions.userId),
    rows<{ user_id: string; at: string }>(sql`select user_id, ${iso('max(a.at)')} as at from ${ACTIVITY} a where a.user_id in (${inList}) group by user_id`),
  ]);
  const byId = new Map(users.map((u) => [u.id, u]));
  return list.flatMap((id) => {
    const u = byId.get(id);
    if (!u) return [];
    const guest = !!u.isAnonymous;
    const n = { speaking: 0, writing: 0, listening: 0, reading: 0 };
    for (const c of counts) if (c.user_id === id) n[c.skill] = Number(c.n);
    return [{
      id,
      email: guest ? '' : u.email,
      name: u.name,
      isGuest: guest,
      emailVerified: u.emailVerified,
      createdAt: u.createdAt.toISOString(),
      lastActiveAt: active.find((a) => a.user_id === id)?.at ?? null,
      counts: n,
      replays: replayCounts.find((r) => r.userId === id)?.n ?? 0,
      cambridge: cambridgeInfo(u.email, u.emailVerified, guest),
    }];
  });
}

// ---------- test health ----------
const health = (r: { id: string; title: string; skill: Skill; part: number | null; source: string; started: string; finished: string; band: string | null; raw: string | null }): TestHealth => ({
  id: r.id, title: r.title, skill: r.skill, part: r.part, source: r.source, started: Number(r.started), finished: Number(r.finished),
  completionRate: Number(r.started) ? Number(r.finished) / Number(r.started) : 0, avgBand: r2(r.band), avgRaw: r2(r.raw),
});

// ---------- speaking audio coverage ----------
async function speakingAudio(): Promise<Content['speakingAudio']> {
  const have = await renderedHashes();
  const list = await db.select().from(prompts).where(and(eq(prompts.skill, 'speaking'), eq(prompts.source, 'generated'))); // Cambridge prompts have no examiner audio
  const all = new Set<string>();
  let fully = 0;
  for (const p of list) {
    const l = speakingLines(p);
    const hashes = [l.intro, l.lead, ...l.questions].filter((t): t is string => !!t).map(speakingAudioHash);
    hashes.forEach((h) => all.add(h));
    if (have && hashes.every((h) => have.has(h))) fully++;
  }
  return { prompts: list.length, promptsFullyRendered: fully, lines: all.size, linesRendered: have ? [...all].filter((h) => have.has(h)).length : 0, manifestEntries: have ? have.size : null };
}

const ok = <T extends z.ZodTypeAny>(schema: T, description = 'OK') => ({ 200: { description, content: { 'application/json': { schema } } } });
const notFound = { 404: { description: 'Not found' } };
const A = { tags: ['Admin'], security: [{ bearer: [] as string[] }], middleware: [requireOwner] }; // ponytail: adminRoute is a readonly tuple that createRoute rejects; same guard, mutable
const get = <S extends z.ZodTypeAny, Rq extends NonNullable<RouteConfig['request']>>(path: string, summary: string, response: S, request: Rq) =>
  createRoute({ ...A, method: 'get', path, summary, request, responses: { ...ok(response), ...notFound } });

export function register(app: App) {
  app.openapi(get('/api/admin/overview', 'Counts: accounts, guests, signups, active users, tests today', Overview, {}), async (c) => {
    const [[u], active, tests, [fb]] = await Promise.all([
      rows<Record<string, string>>(sql`select
        count(*) filter (where not coalesce(is_anonymous, false)) as accounts, count(*) filter (where coalesce(is_anonymous, false)) as guests,
        count(*) filter (where not coalesce(is_anonymous, false) and created_at >= ${daysAgo(0)}) as s0, count(*) filter (where not coalesce(is_anonymous, false) and created_at >= ${since(7)}) as s7, count(*) filter (where not coalesce(is_anonymous, false) and created_at >= ${since(30)}) as s30,
        count(*) filter (where coalesce(is_anonymous, false) and created_at >= ${daysAgo(0)}) as g0, count(*) filter (where coalesce(is_anonymous, false) and created_at >= ${since(7)}) as g7, count(*) filter (where coalesce(is_anonymous, false) and created_at >= ${since(30)}) as g30
        from "user"`),
      rows<{ guest: boolean; t: string; w: string }>(sql`select coalesce(u.is_anonymous, false) as guest, count(distinct a.user_id) filter (where a.at >= ${daysAgo(0)}) as t, count(distinct a.user_id) as w
        from ${ACTIVITY} a join "user" u on u.id = a.user_id where a.at >= ${since(7)} group by 1`),
      rows<{ skill: Skill; started: string; finished: string }>(sql`select skill, sum(started) as started, sum(finished) as finished from (
        select skill::text as skill, count(*) filter (where created_at >= ${daysAgo(0)}) as started, count(*) filter (where status = 'done' and updated_at >= ${daysAgo(0)}) as finished from attempts where updated_at >= ${daysAgo(0)} group by 1
        union all select t.skill, count(*) filter (where l.started_at >= ${daysAgo(0)}), count(*) filter (where l.submitted_at >= ${daysAgo(0)}) from lr_attempts l join lr_tests t on t.id = l.test_id where l.started_at >= ${daysAgo(0)} or l.submitted_at >= ${daysAgo(0)} group by 1) x group by 1`),
      db.select({ n: count() }).from(feedback).where(eq(feedback.status, 'new')),
    ]);
    const a = (guest: boolean, k: 't' | 'w') => Number(active.find((r) => r.guest === guest)?.[k] ?? 0);
    const n = (k: string) => Number(u![k]);
    return c.json(
      {
        accounts: n('accounts'), guests: n('guests'),
        signups: { today: n('s0'), d7: n('s7'), d30: n('s30') },
        newGuests: { today: n('g0'), d7: n('g7'), d30: n('g30') },
        activeUsers: { today: { accounts: a(false, 't'), guests: a(true, 't') }, d7: { accounts: a(false, 'w'), guests: a(true, 'w') } },
        testsToday: Object.fromEntries(SKILLS.map((s) => [s, { started: Number(tests.find((t) => t.skill === s)?.started ?? 0), finished: Number(tests.find((t) => t.skill === s)?.finished ?? 0) }])) as Record<Skill, { started: number; finished: number }>,
        feedbackNew: fb!.n,
        generatedAt: new Date().toISOString(),
      },
      200,
    );
  });

  app.openapi(get('/api/admin/growth', 'Daily signups, new guests and active users; guest to account conversion', Growth, { query: z.object({ days: z.coerce.number().pipe(z.union([z.literal(30), z.literal(90)])).default(30) }) }), async (c) => {
    const { days } = c.req.valid('query');
    const [series, [conv]] = await Promise.all([
      rows<{ date: string; signups: string; guests: string; active: string }>(sql`
        with d as (select to_char(g, 'YYYY-MM-DD') as date from generate_series((now() at time zone 'Asia/Dhaka')::date - ${days - 1}::int, (now() at time zone 'Asia/Dhaka')::date, interval '1 day') g),
        s as (select ${dhakaDay(sql`created_at`)} as date, count(*) filter (where not coalesce(is_anonymous, false)) as signups, count(*) filter (where coalesce(is_anonymous, false)) as guests from "user" where created_at >= ${since(days)} group by 1),
        a as (select ${dhakaDay(sql`at`)} as date, count(distinct user_id) as n from ${ACTIVITY} x where at >= ${since(days)} group by 1)
        select d.date, coalesce(s.signups, 0) as signups, coalesce(s.guests, 0) as guests, coalesce(a.n, 0) as active from d left join s using (date) left join a using (date) order by d.date`),
      rows<{ guests: string; converted: string }>(sql`select
        (select count(*) from "user" where coalesce(is_anonymous, false) and created_at >= ${since(days)}) + (select count(*) from guest_conversions where guest_created_at >= ${since(days)}) as guests,
        (select count(*) from guest_conversions where guest_created_at >= ${since(days)}) as converted`),
    ]);
    const guests = Number(conv!.guests);
    const converted = Number(conv!.converted);
    return c.json({ days, series: series.map((r) => ({ date: r.date, signups: Number(r.signups), newGuests: Number(r.guests), active: Number(r.active) })), conversion: { guests, converted, rate: guests ? converted / guests : 0 } }, 200);
  });

  app.openapi(get('/api/admin/activity', 'Every test anyone started, newest first', ActivityPage, { query: pageQuery.extend({ skill: SkillS.optional(), q: z.string().trim().min(1).max(100).optional() }) }), async (c) => {
    const { page, pageSize, skill, q } = c.req.valid('query');
    const filters = [skill && sql`f.skill = ${skill}`, q && sql`f.email ilike ${like(q)}`].filter((x): x is SQL => !!x);
    const { items, total } = await feed(filters, pageSize, (page - 1) * pageSize);
    return c.json({ items, page, pageSize, total }, 200);
  });

  app.openapi(
    get('/api/admin/users', 'Users and guests with usage counts', UsersPage, {
      query: pageQuery.extend({ q: z.string().trim().min(1).max(100).optional(), kind: z.enum(['all', 'accounts', 'guests']).default('accounts'), sort: z.enum(['created', 'active']).default('created') }),
    }),
    async (c) => {
      const { page, pageSize, q, kind, sort } = c.req.valid('query');
      const where = sql.join([sql`true`, kind === 'accounts' && sql`not coalesce(u.is_anonymous, false)`, kind === 'guests' && sql`coalesce(u.is_anonymous, false)`, q && sql`u.email ilike ${like(q)}`].filter((x): x is SQL => !!x), sql` and `);
      const order = sort === 'active' ? sql`l.la desc nulls last, u.created_at desc` : sql`u.created_at desc`;
      // ponytail: sort=active aggregates the activity of every user to order them; fine at this size, add a users.last_active_at column if it gets slow
      const join = sort === 'active' ? sql`left join (select user_id, max(at) as la from ${ACTIVITY} a group by user_id) l on l.user_id = u.id` : sql``;
      const [[t], idRows] = await Promise.all([
        rows<{ n: string }>(sql`select count(*) as n from "user" u where ${where}`),
        rows<{ id: string }>(sql`select u.id from "user" u ${join} where ${where} order by ${order}, u.id limit ${pageSize} offset ${(page - 1) * pageSize}`),
      ]);
      return c.json({ items: await userRows(idRows.map((r) => r.id)), page, pageSize, total: Number(t!.n) }, 200);
    },
  );

  app.openapi(get('/api/admin/users/{id}', 'One user: attempts, band trend, recordings, replays', UserDetail, { params: z.object({ id: z.string() }) }), async (c) => {
    const { id } = c.req.valid('param');
    const [u] = await userRows([id]);
    if (!u) throw new HTTPException(404, { message: 'Not found' });
    const [{ items: attempts }, trend, recs, replays] = await Promise.all([
      feed([sql`f.user_id = ${id}`], 100),
      rows<{ skill: Skill; at: string; band: string }>(sql`select skill, ${iso('at')} as at, band from (
        select skill, at, band, row_number() over (partition by skill order by at desc) as rn from (
          select a.skill::text as skill, a.created_at as at, an.overall as band from attempts a join analyses an on an.attempt_id = a.id where a.user_id = ${id} and a.status = 'done'
          union all select t.skill, l.submitted_at, l.band from lr_attempts l join lr_tests t on t.id = l.test_id where l.user_id = ${id} and l.status = 'submitted' and l.band is not null and l.submitted_at is not null) x) y
        where rn <= 60 order by skill, at`),
      db.query.attempts.findMany({ where: (a, { and, eq, isNotNull }) => and(eq(a.userId, id), eq(a.skill, 'speaking'), isNotNull(a.audioKey)), orderBy: (a, { desc }) => desc(a.createdAt), limit: 50, columns: { id: true, part: true, createdAt: true, durationMs: true, audioKey: true } }),
      db.select().from(replaySessions).where(eq(replaySessions.userId, id)).orderBy(desc(replaySessions.startedAt)).limit(30),
    ]);
    const bandTrend = Object.fromEntries(SKILLS.map((s) => [s, trend.filter((t) => t.skill === s).map((t) => ({ at: t.at, band: Number(t.band) }))])) as UserDetail['bandTrend'];
    const recordings = await Promise.all(recs.map(async (r) => ({ attemptId: r.id, part: r.part, createdAt: r.createdAt.toISOString(), durationMs: r.durationMs, audioUrl: r.audioKey ? await storage.presignGet(r.audioKey, 3600) : null })));
    const replayItems: ReplayItem[] = replays.map((r) => ({ id: r.id, userId: r.userId, email: u.email, startedAt: r.startedAt.toISOString(), lastAt: r.lastAt.toISOString(), durationS: (r.lastAt.getTime() - r.startedAt.getTime()) / 1000, pages: r.pages, bytes: r.bytes, chunks: r.chunks, userAgent: r.userAgent }));
    return c.json({ user: u, attempts, bandTrend, recordings, replays: replayItems, cambridge: u.cambridge }, 200);
  });

  app.openapi(get('/api/admin/tests', 'Per-prompt and per-L/R-test completion and scores', Tests, { query: z.object({ days: z.coerce.number().int().min(1).max(365).default(90) }) }), async (c) => {
    const { days } = c.req.valid('query');
    const [p, l] = await Promise.all([
      rows<Parameters<typeof health>[0]>(sql`select p.id, p.title, p.skill::text as skill, p.part, p.source::text as source, count(*) as started, count(*) filter (where a.status = 'done') as finished, avg(an.overall) as band, null as raw
        from attempts a join prompts p on p.id = a.prompt_id left join analyses an on an.attempt_id = a.id where a.created_at >= ${since(days)} group by p.id order by started desc, p.id limit 200`),
      rows<Parameters<typeof health>[0]>(sql`select t.id, t.title, t.skill, null::int as part, t.source, count(*) as started, count(*) filter (where l.status = 'submitted') as finished, avg(l.band) as band, avg(l.raw) as raw
        from lr_attempts l join lr_tests t on t.id = l.test_id where l.started_at >= ${since(days)} group by t.id order by started desc, t.id limit 200`),
    ]);
    return c.json({ prompts: p.map(health), lr: l.map(health) }, 200);
  });

  app.openapi(get('/api/admin/tests/{testId}/missed', 'Most-missed questions of a Listening/Reading test', Missed, { params: z.object({ testId: z.string() }) }), async (c) => {
    const { testId } = c.req.valid('param');
    const [t] = await db.select({ title: lrTests.title }).from(lrTests).where(eq(lrTests.id, testId));
    if (!t) throw new HTTPException(404, { message: 'Not found' });
    const [[s], qs] = await Promise.all([
      db.select({ n: count() }).from(lrAttempts).where(and(eq(lrAttempts.testId, testId), eq(lrAttempts.status, 'submitted'), sql`${lrAttempts.marks} is not null`)),
      rows<{ n: number; total: string; answered: string; missed: string }>(sql`select * from (
        select (m->>'n')::int as n, count(*) as total, count(*) filter (where btrim(m->>'given') <> '') as answered, count(*) filter (where (m->>'correct')::boolean = false) as missed
        from lr_attempts l, jsonb_array_elements(l.marks) m where l.test_id = ${testId} and l.status = 'submitted' and l.marks is not null group by 1) q order by missed::float / total desc, missed desc, n limit 15`),
    ]);
    return c.json({ testId, title: t.title, submitted: s!.n, questions: qs.map((q) => ({ n: q.n, answered: Number(q.answered), missed: Number(q.missed), missRate: Number(q.missed) / Number(q.total) })) }, 200);
  });

  app.openapi(get('/api/admin/funnel', 'Visited, started, finished, signed up, returned', Funnel, { query: z.object({ days: z.coerce.number().pipe(z.union([z.literal(7), z.literal(30), z.literal(90)])).default(30) }) }), async (c) => {
    const { days } = c.req.valid('query');
    const [f] = await rows<Record<string, string>>(sql`select count(*) as visited,
      count(*) filter (where exists (select 1 from attempts where user_id = u.id) or exists (select 1 from lr_attempts where user_id = u.id)) as started,
      count(*) filter (where exists (select 1 from attempts where user_id = u.id and status = 'done') or exists (select 1 from lr_attempts where user_id = u.id and status = 'submitted')) as finished,
      count(*) filter (where not coalesce(u.is_anonymous, false)) as signed_up,
      count(*) filter (where exists (select 1 from ${ACTIVITY} a where a.user_id = u.id and a.at >= (date_trunc('day', u.created_at at time zone 'Asia/Dhaka') + interval '1 day') at time zone 'Asia/Dhaka')) as returned
      from "user" u where u.created_at >= ${since(days)}`);
    const step = (key: 'visited' | 'started' | 'finished' | 'signedUp' | 'returned', label: string, col: string) => ({ key, label, users: Number(f![col]), pctOfVisited: Number(f!.visited) ? Number(f![col]) / Number(f!.visited) : 0 });
    return c.json({ days, steps: [step('visited', 'Visited', 'visited'), step('started', 'Started a test', 'started'), step('finished', 'Finished a test', 'finished'), step('signedUp', 'Signed up', 'signed_up'), step('returned', 'Came back another day', 'returned')] }, 200);
  });

  app.openapi(get('/api/admin/content', 'Question bank counts and examiner-audio coverage', Content, {}), async (c) => {
    const [p, l, audio] = await Promise.all([
      rows<{ skill: 'speaking' | 'writing'; part: number; source: 'generated' | 'cambridge'; n: string }>(sql`select skill::text as skill, part, source::text as source, count(*) as n from prompts group by 1, 2, 3 order by 1, 2, 3`),
      rows<{ skill: 'listening' | 'reading'; source: 'cambridge' | 'generated'; variant: 'academic' | 'general'; n: string }>(sql`select skill, source, variant, count(*) as n from lr_tests group by 1, 2, 3 order by 1, 2, 3`),
      speakingAudio(),
    ]);
    return c.json({ prompts: p.map((r) => ({ skill: r.skill, part: r.part, source: r.source, count: Number(r.n) })), lr: l.map((r) => ({ skill: r.skill, source: r.source, variant: r.variant, tests: Number(r.n) })), speakingAudio: audio }, 200);
  });
}
