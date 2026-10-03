import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import type { LrTest } from '@ielts/core';
import { db } from '../db/client';
import { lrTests } from '../db/schema';
import { guestUser, req, testUser } from '../test/helpers';

const body = async (r: Response) => (await r.json()) as any;
const fixture = (n: string) => JSON.parse(readFileSync(new URL(`../test/fixtures/lr/lr-${n}.json`, import.meta.url), 'utf8')) as LrTest;
const ALLOWED = 'soyebjim@gmail.com';

async function seed(t: LrTest) {
  const [row] = await db.insert(lrTests).values({ slug: t.slug, skill: t.skill, variant: t.variant, source: t.source, ref: t.ref, title: t.title, data: t, restricted: t.source === 'cambridge' }).returning();
  return row!.id;
}
/** Answers every question of a test correctly, as the client would send them (string keys). */
const perfect = (t: LrTest) => {
  const r: Record<string, string> = {};
  for (const s of t.sections) for (const g of s.groups) {
    if (g.type === 'mcq-multi') g.questions.forEach((q, i) => (r[q.n] = g.questions[0]!.answer![i]!));
    else for (const q of g.questions) r[q.n] = q.answer![0]!;
  }
  return r;
};

describe('listening & reading tests', () => {
  let rid: string, lid: string;
  beforeEach(async () => {
    rid = await seed(fixture('reading'));
    lid = await seed(fixture('listening'));
  });

  describe('access', () => {
    let cid: string;
    beforeEach(async () => {
      const c = fixture('reading');
      cid = await seed({ ...c, slug: 'cam-reading-1', source: 'cambridge', ref: 'Cambridge 19 Test 1', title: 'Cambridge 19 Test 1' });
    });

    it('a visitor sees only the open tests; no session cannot start one', async () => {
      const r = await body(await req('/api/lr/tests'));
      expect(r.items.map((i: any) => i.slug).sort()).toEqual(['dev-listening-1', 'dev-reading-1']);
      expect((await req(`/api/lr/tests/${rid}`)).status).toBe(401);
    });
    it('guests and non-allowed users list and take only the open tests; Cambridge is 404', async () => {
      const g = await guestUser();
      const other = await testUser('someone@x.com');
      const unverified = await testUser(ALLOWED, { verified: false });
      for (const { headers } of [g, other, unverified]) {
        expect((await body(await req('/api/lr/tests', { headers }))).items.map((i: any) => i.source)).toEqual(['generated', 'generated']);
        expect((await req(`/api/lr/tests/${rid}`, { headers })).status).toBe(200);
        expect((await req(`/api/lr/tests/${cid}`, { headers })).status).toBe(404);
        expect((await req(`/api/lr/tests/${cid}/attempts`, { headers, body: { mode: 'practice' } })).status).toBe(404);
        const a = await body(await req(`/api/lr/tests/${rid}/attempts`, { headers, body: { mode: 'practice' } }));
        expect((await req(`/api/lr/attempts/${a.id}`, { headers })).status).toBe(200);
        expect((await req(`/api/lr/attempts/${a.id}/submit`, { headers, body: {} })).status).toBe(200);
      }
    });
    it('an attempt on a Cambridge test is 404 once access is lost', async () => {
      const { headers } = await testUser(ALLOWED);
      const a = await body(await req(`/api/lr/tests/${cid}/attempts`, { headers, body: { mode: 'practice' } }));
      expect((await req(`/api/lr/attempts/${a.id}`, { headers })).status).toBe(200);
      const { env } = await import('../env');
      const kept = [...env.CAMBRIDGE_ALLOWED_EMAILS];
      env.CAMBRIDGE_ALLOWED_EMAILS.length = 0;
      try {
        expect((await req(`/api/lr/attempts/${a.id}`, { headers })).status).toBe(404);
        expect((await req(`/api/lr/attempts/${a.id}`, { headers, method: 'PUT', body: { responses: {}, elapsedS: 1 } })).status).toBe(404);
        expect((await req(`/api/lr/attempts/${a.id}/submit`, { headers, body: {} })).status).toBe(404);
        expect((await body(await req('/api/lr/attempts', { headers }))).items).toHaveLength(1);
      } finally {
        env.CAMBRIDGE_ALLOWED_EMAILS.push(...kept);
      }
    });
    it('an allow-listed account sees both', async () => {
      const { headers } = await testUser(ALLOWED);
      expect((await body(await req('/api/lr/tests', { headers }))).items).toHaveLength(3);
      expect((await req(`/api/lr/tests/${cid}`, { headers })).status).toBe(200);
    });
    it('/api/me exposes cambridgeAccess', async () => {
      const { headers } = await testUser(ALLOWED);
      expect((await body(await req('/api/me', { headers }))).cambridgeAccess).toBe(true);
    });
  });

  describe('allowed user', () => {
    let headers: Headers;
    beforeEach(async () => {
      headers = (await testUser(ALLOWED)).headers;
    });

    it('list and get never contain answers or transcripts, and presign assets', async () => {
      const list = await req('/api/lr/tests', { headers });
      const lt = await list.text();
      expect(JSON.parse(lt).items).toHaveLength(2);
      expect(lt).not.toContain('"answer"');
      expect(lt).not.toContain('"data"');
      const get = await req(`/api/lr/tests/${lid}`, { headers });
      const gt = await get.text();
      expect(gt).not.toContain('"answer"');
      expect(gt).not.toContain('"transcript"');
      expect(gt).not.toContain('Whitlock');
      const j = JSON.parse(gt);
      expect(j.assets['dev-l1/part1.mp3']).toBe('https://download.test/lr/dev-l1/part1.mp3');
      expect(j.assets['dev-l1/map.svg']).toBeTruthy();
    });

    it('filters by skill and source', async () => {
      expect((await body(await req('/api/lr/tests?skill=reading', { headers }))).items.map((i: any) => i.slug)).toEqual(['dev-reading-1']);
      expect((await body(await req('/api/lr/tests?source=cambridge', { headers }))).items).toEqual([]);
    });

    it('start resumes the in-progress attempt instead of creating a duplicate', async () => {
      const a = await body(await req(`/api/lr/tests/${rid}/attempts`, { headers, body: { mode: 'exam' } }));
      const b = await body(await req(`/api/lr/tests/${rid}/attempts`, { headers, body: { mode: 'practice' } }));
      expect(b.id).toBe(a.id);
      expect(b.mode).toBe('exam');
      expect(JSON.stringify(b)).not.toContain('"answer"');
      expect((await body(await req('/api/lr/attempts', { headers }))).items).toHaveLength(1);
    });

    it('autosaves responses and elapsed, and list shows progress', async () => {
      const a = await body(await req(`/api/lr/tests/${rid}/attempts`, { headers, body: { mode: 'practice' } }));
      const put = await req(`/api/lr/attempts/${a.id}`, { headers, method: 'PUT', body: { responses: { '1': 'TRUE', '7': 'castoreum', '99': 'junk', '2': ' ' }, elapsedS: 42 } });
      expect(put.status).toBe(200);
      const got = await body(await req(`/api/lr/attempts/${a.id}`, { headers }));
      expect(got.responses).toEqual({ '1': 'TRUE', '7': 'castoreum' });
      expect(got.elapsedS).toBe(42);
      expect(got.status).toBe('in_progress');
      expect(got.marks).toBeNull();
      expect(JSON.stringify(got)).not.toContain('"answer"');
      const item = (await body(await req('/api/lr/tests?skill=reading', { headers }))).items[0];
      expect([item.status, item.answered, item.attemptId]).toEqual(['in_progress', 2, a.id]);
    });

    it('submit scores with scoreLr, reveals answers and transcript, and cannot be repeated', async () => {
      const a = await body(await req(`/api/lr/tests/${lid}/attempts`, { headers, body: { mode: 'practice' } }));
      const answers = perfect(fixture('listening'));
      answers['1'] = 'wrong';
      answers['2'] = 'thursday '; // case/space-insensitive
      const r = await req(`/api/lr/attempts/${a.id}/submit`, { headers, body: { responses: answers, elapsedS: 600 } });
      expect(r.status).toBe(200);
      const s = await body(r);
      expect([s.status, s.raw, s.total, s.band]).toEqual(['submitted', 39, 40, 9]);
      expect(s.marks.find((m: any) => m.n === 1)).toMatchObject({ correct: false, given: 'wrong', answer: ['Whitlock'] });
      expect(s.test.sections[0].transcript).toContain('Whitlock');
      expect(s.test.sections[0].groups[0].questions[0].answer).toEqual(['Whitlock']);
      expect((await req(`/api/lr/attempts/${a.id}/submit`, { headers, body: {} })).status).toBe(409);
      expect((await req(`/api/lr/attempts/${a.id}`, { headers, method: 'PUT', body: { responses: {}, elapsedS: 1 } })).status).toBe(409);
      const item = (await body(await req('/api/lr/tests?skill=listening', { headers }))).items[0];
      expect([item.status, item.bestBand, item.attempts, item.attemptId]).toEqual(['submitted', 9, 1, null]);
      // a retake creates a new attempt
      const again = await body(await req(`/api/lr/tests/${lid}/attempts`, { headers, body: { mode: 'exam' } }));
      expect(again.id).not.toBe(a.id);
    });

    it('submit without a body scores the autosaved responses; an empty attempt is band 0', async () => {
      const a = await body(await req(`/api/lr/tests/${rid}/attempts`, { headers, body: { mode: 'exam' } }));
      await req(`/api/lr/attempts/${a.id}`, { headers, method: 'PUT', body: { responses: { '1': 't', '2': 'f' }, elapsedS: 5 } });
      const s = await body(await req(`/api/lr/attempts/${a.id}/submit`, { headers, body: {} }));
      expect([s.raw, s.total]).toEqual([2, 40]); // "t" → TRUE is correct for Q1; Q2 FALSE correct
      expect(s.band).toBeLessThan(3);
    });

    it('rejects malformed responses', async () => {
      const a = await body(await req(`/api/lr/tests/${rid}/attempts`, { headers, body: { mode: 'exam' } }));
      expect((await req(`/api/lr/attempts/${a.id}`, { headers, method: 'PUT', body: { responses: { x: 'a' }, elapsedS: 1 } })).status).toBe(400);
      expect((await req(`/api/lr/tests/${rid}/attempts`, { headers, body: { mode: 'nope' } })).status).toBe(400);
    });

    it('a single part: only its questions are sent, saved and scored, with no band; trend and best band skip it', async () => {
      const a = await body(await req(`/api/lr/tests/${rid}/attempts`, { headers, body: { mode: 'exam', parts: [2] } }));
      expect(a.parts).toEqual([2]);
      expect(a.test.sections.map((s: any) => s.part)).toEqual([2]);
      expect(JSON.stringify(a)).not.toContain('"answer"');
      await req(`/api/lr/attempts/${a.id}`, { headers, method: 'PUT', body: { responses: { '1': 'TRUE', '14': 'A' }, elapsedS: 5 } });
      expect((await body(await req(`/api/lr/attempts/${a.id}`, { headers }))).responses).toEqual({ '14': 'A' });
      const s = await body(await req(`/api/lr/attempts/${a.id}/submit`, { headers, body: { responses: perfect(fixture('reading')) } }));
      expect([s.raw, s.total, s.band, s.parts]).toEqual([13, 13, null, [2]]);
      expect(s.marks.map((m: any) => m.n)).toEqual([14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26]);
      expect(s.test.sections[0].groups[0].questions[0].answer).toBeTruthy();
      const item = (await body(await req('/api/lr/tests?skill=reading', { headers }))).items[0];
      expect([item.status, item.bestBand, item.attempts]).toEqual(['submitted', null, 1]);
      expect((await body(await req('/api/lr/attempts', { headers }))).items[0]).toMatchObject({ parts: [2], band: null, raw: 13, total: 13 });
      expect((await body(await req('/api/lr/progress', { headers }))).trend).toEqual([]);
    });

    it('every part chosen is the whole test; a part the test lacks is 400', async () => {
      const a = await body(await req(`/api/lr/tests/${rid}/attempts`, { headers, body: { mode: 'practice', parts: [3, 1, 2] } }));
      expect(a.parts).toBeNull();
      expect(a.test.sections).toHaveLength(3);
      expect((await req(`/api/lr/tests/${rid}/attempts`, { headers, body: { mode: 'practice', parts: [4], fresh: true } })).status).toBe(400);
      expect((await req(`/api/lr/tests/${lid}/attempts`, { headers, body: { mode: 'exam', parts: [4] } })).status).toBe(200);
    });

    it('fresh discards the in-progress attempt of that test and starts a new one', async () => {
      const a = await body(await req(`/api/lr/tests/${lid}/attempts`, { headers, body: { mode: 'exam' } }));
      await req(`/api/lr/attempts/${a.id}`, { headers, method: 'PUT', body: { responses: { '1': 'x' }, elapsedS: 9 } });
      const item = (await body(await req('/api/lr/tests?skill=listening', { headers }))).items[0];
      expect([item.attemptId, item.mode, item.parts, item.answered, item.total]).toEqual([a.id, 'exam', null, 1, 40]);
      const b = await body(await req(`/api/lr/tests/${lid}/attempts`, { headers, body: { mode: 'practice', parts: [1], fresh: true } }));
      expect(b.id).not.toBe(a.id);
      expect([b.mode, b.parts, b.responses, b.elapsedS]).toEqual(['practice', [1], {}, 0]);
      expect((await req(`/api/lr/attempts/${a.id}`, { headers })).status).toBe(404);
      expect((await body(await req('/api/lr/attempts', { headers }))).items.map((x: any) => x.id)).toEqual([b.id]);
      const again = (await body(await req('/api/lr/tests?skill=listening', { headers }))).items[0];
      expect([again.attemptId, again.parts, again.total]).toEqual([b.id, [1], 10]);
    });

    it("cannot read, save or submit another user's attempt", async () => {
      const a = await body(await req(`/api/lr/tests/${rid}/attempts`, { headers, body: { mode: 'practice' } }));
      const other = (await testUser('jim.second@x.com')).headers;
      // a second allow-listed user is not possible via env, so use the same gate but a different account: patch env list at runtime
      const { env } = await import('../env');
      env.CAMBRIDGE_ALLOWED_EMAILS.push('jim.second@x.com');
      try {
        expect((await req(`/api/lr/attempts/${a.id}`, { headers: other })).status).toBe(404);
        expect((await req(`/api/lr/attempts/${a.id}`, { headers: other, method: 'PUT', body: { responses: {}, elapsedS: 1 } })).status).toBe(404);
        expect((await req(`/api/lr/attempts/${a.id}/submit`, { headers: other, body: {} })).status).toBe(404);
        expect((await body(await req('/api/lr/attempts', { headers: other }))).items).toEqual([]);
      } finally {
        env.CAMBRIDGE_ALLOWED_EMAILS.pop();
      }
    });
  });
});

describe('listening & reading review', () => {
  const enrich = (t: LrTest): LrTest => {
    const c = structuredClone(t);
    c.sections[0]!.groups[0]!.questions[0]!.review = { evidence: 'the secret evidence', why: 'because', wrong: { FALSE: 'no' }, paraphrase: [['a', 'b']] };
    c.sections[0]!.vocab = [{ word: 'sediment', meaning: 'dregs' }];
    if (c.skill === 'listening') c.sections[0]!.timings = [['Whitlock', 1, 2]];
    return c;
  };
  const start = async (id: string, headers: Headers) => body(await req(`/api/lr/tests/${id}/attempts`, { headers, body: { mode: 'practice' } }));

  it('review, vocab and timings never reach the client before submit, but do after', async () => {
    const lid = await seed(enrich(fixture('listening')));
    const rid = await seed(enrich(fixture('reading')));
    const { headers } = await guestUser();
    for (const id of [lid, rid]) {
      const a = await start(id, headers);
      for (const raw of [JSON.stringify(a), JSON.stringify(await body(await req(`/api/lr/tests/${id}`, { headers }))), JSON.stringify(await body(await req(`/api/lr/attempts/${a.id}`, { headers })))])
        for (const k of ['"review"', '"vocab"', '"timings"', 'secret evidence', '"answer"']) expect(raw).not.toContain(k);
      const s = await body(await req(`/api/lr/attempts/${a.id}/submit`, { headers, body: {} }));
      expect(s.test.sections[0].groups[0].questions[0].review).toMatchObject({ evidence: 'the secret evidence', why: 'because' });
      expect(s.test.sections[0].vocab).toEqual([{ word: 'sediment', meaning: 'dregs' }]);
    }
    const a = await start(lid, headers);
    const s = await body(await req(`/api/lr/attempts/${a.id}/submit`, { headers, body: {} }));
    expect(s.test.sections[0].timings).toEqual([['Whitlock', 1, 2]]);
  });

  it('persists stats on autosave and submit, and rejects malformed stats', async () => {
    const rid = await seed(fixture('reading'));
    const { headers } = await guestUser();
    const a = await start(rid, headers);
    const stats = { partS: { '1': 600, '2': 300 }, changes: { '7': 2 }, late: [38, 39] };
    expect((await req(`/api/lr/attempts/${a.id}`, { headers, method: 'PUT', body: { responses: {}, elapsedS: 9, stats } })).status).toBe(200);
    expect((await body(await req(`/api/lr/attempts/${a.id}`, { headers }))).stats).toEqual(stats);
    expect((await req(`/api/lr/attempts/${a.id}`, { headers, method: 'PUT', body: { responses: {}, elapsedS: 9, stats: { partS: { x: 1 }, changes: {}, late: [] } } })).status).toBe(400);
    const s = await body(await req(`/api/lr/attempts/${a.id}/submit`, { headers, body: { stats: { ...stats, late: [40] } } }));
    expect(s.stats.late).toEqual([40]);
  });

  it('stores practice audio resume state, validates it, and keeps it when a client omits it', async () => {
    const rid = await seed(fixture('listening'));
    const { headers } = await guestUser();
    const a = await start(rid, headers);
    const base = { partS: {}, changes: {}, late: [] };
    const audio = { pos: { '1': 205.5, '3': 12 }, rate: 1.25 };
    const put = (stats: unknown) => req(`/api/lr/attempts/${a.id}`, { headers, method: 'PUT', body: { responses: {}, elapsedS: 9, stats } });
    expect((await put({ ...base, audio })).status).toBe(200);
    expect((await body(await req(`/api/lr/attempts/${a.id}`, { headers }))).stats.audio).toEqual(audio);
    expect((await put({ ...base, audio: { pos: { '1': -1 } } })).status).toBe(400);
    expect((await put({ ...base, audio: { pos: { '1': 4000 } } })).status).toBe(400);
    expect((await put({ ...base, audio: { pos: {}, rate: 2 } })).status).toBe(400);
    expect((await put(base)).status).toBe(200); // older client without audio
    expect((await body(await req(`/api/lr/attempts/${a.id}`, { headers }))).stats.audio).toEqual(audio);
  });

  it('classifies slips, creates one spelling card per word, notes earlier misspellings', async () => {
    const rid = await seed(fixture('reading'));
    const { headers } = await testUser();
    const run = async (typed: string) => {
      const a = await start(rid, headers);
      return body(await req(`/api/lr/attempts/${a.id}/submit`, { headers, body: { responses: { '7': typed, '8': 'lochs', '9': 'sediments', '10': '' } } }));
    };
    const first = await run('castoreumm');
    expect(first.analysis.gaps).toEqual(expect.arrayContaining([expect.objectContaining({ n: 7, kind: 'spelling', word: 'castoreum', before: 0 }), expect.objectContaining({ n: 9, kind: 'plural', word: 'sediment' }), expect.objectContaining({ n: 10, kind: 'blank' })]));
    expect(first.analysis.byType.length).toBeGreaterThan(1);
    const second = await run('castorium');
    expect(second.analysis.gaps.find((g: any) => g.n === 7)).toMatchObject({ kind: 'spelling', before: 1 });
    const due = await body(await req('/api/cards/due', { headers }));
    expect(due.cards).toHaveLength(1);
    expect(due.cards[0]).toMatchObject({ source: 'mistake' });
    expect(due.cards[0].front).toContain("'cas___eum' (9 letters)");
    expect(due.cards[0].back).toContain('castoreum');
    const sp = await body(await req('/api/lr/spelling', { headers }));
    expect(sp.items[0]).toMatchObject({ word: 'castoreum', kind: 'spelling', count: 2 });
    expect(sp.items[0].typed.sort()).toEqual(['castorium', 'castoreumm'].sort());
  });

  it('delete: owner only, in-progress or submitted; spelling and progress forget it', async () => {
    const rid = await seed(fixture('reading'));
    const { headers } = await testUser();
    const other = await testUser('someone@x.com');
    const a = await start(rid, headers);
    await req(`/api/lr/attempts/${a.id}/submit`, { headers, body: { responses: { '7': 'castorium' } } });
    expect((await body(await req('/api/lr/spelling', { headers }))).items).toHaveLength(1);
    expect((await req(`/api/lr/attempts/${a.id}`, { method: 'DELETE', headers: other.headers })).status).toBe(404);
    expect((await req(`/api/lr/attempts/${a.id}`, { method: 'DELETE', headers })).status).toBe(200);
    expect((await req(`/api/lr/attempts/${a.id}`, { method: 'DELETE', headers })).status).toBe(404);
    expect((await body(await req('/api/lr/attempts', { headers }))).items).toEqual([]);
    expect((await body(await req('/api/lr/spelling', { headers }))).items).toEqual([]);
    expect((await body(await req('/api/lr/progress', { headers }))).trend).toEqual([]);
    const b = await start(rid, headers);
    expect((await req(`/api/lr/attempts/${b.id}`, { method: 'DELETE', headers })).status).toBe(200);
  });

  it('progress: trend, accuracy by type, weakest types, a suggested untried test, tfng pattern; per user', async () => {
    const rid = await seed(fixture('reading'));
    const other = await seed({ ...fixture('reading'), slug: 'dev-reading-2', ref: 'G2', title: 'Second' });
    const { headers } = await guestUser();
    expect(await body(await req('/api/lr/progress', { headers }))).toMatchObject({ trend: [], weakest: [], suggested: null });
    const a = await start(rid, headers);
    // Q1-6 are TFNG: answer NOT GIVEN to all (all wrong or right)
    const r: Record<string, string> = Object.fromEntries([1, 2, 3, 4, 5, 6].map((n) => [n, 'NOT GIVEN']));
    await req(`/api/lr/attempts/${a.id}/submit`, { headers, body: { responses: r } });
    const p = await body(await req('/api/lr/progress', { headers }));
    expect(p.trend).toHaveLength(1);
    expect(p.byType.find((t: any) => t.label === 'True / False / Not Given')).toMatchObject({ skill: 'reading', total: 6 });
    expect(p.weakest.length).toBeGreaterThan(0);
    expect(p.suggested).toMatchObject({ id: other, skill: 'reading' });
    expect(p.tfng.rows).toBeGreaterThan(0);
    expect((await body(await req('/api/lr/progress', { headers: (await guestUser()).headers }))).trend).toEqual([]);
    expect((await req('/api/lr/progress')).status).toBe(401);
    expect((await req('/api/lr/spelling')).status).toBe(401);
  });
});
