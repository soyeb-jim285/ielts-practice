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
  const [row] = await db.insert(lrTests).values({ slug: t.slug, skill: t.skill, variant: t.variant, source: t.source, ref: t.ref, title: t.title, data: t }).returning();
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

  describe('gating', () => {
    it('403 cambridge_required for a guest, a non-allowed user and an unverified allow-listed email', async () => {
      const g = await guestUser();
      const other = await testUser('someone@x.com');
      const unverified = await testUser(ALLOWED, { verified: false });
      for (const { headers } of [g, other, unverified]) {
        for (const [path, method] of [['/api/lr/tests', 'GET'], [`/api/lr/tests/${rid}`, 'GET'], ['/api/lr/attempts', 'GET'], [`/api/lr/tests/${rid}/attempts`, 'POST']] as const) {
          const r = await req(path, { headers, method, body: method === 'POST' ? { mode: 'practice' } : undefined });
          expect([path, r.status, (await body(r)).code]).toEqual([path, 403, 'cambridge_required']);
        }
      }
    });
    it('401 without a session', async () => {
      expect((await req('/api/lr/tests')).status).toBe(401);
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
