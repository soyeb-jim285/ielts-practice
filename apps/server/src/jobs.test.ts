import { expect, it } from 'vitest';
// helpers first: it loads the app, which installs zod .openapi() before settings.ts is evaluated
import { chatReply, fakeFetch, json, req, seedPrompt, testUser } from './test/helpers';
import { eq, sql } from 'drizzle-orm';
import { db } from './db/client';
import { analyses, attempts, liveSessions, mistakes, prompts } from './db/schema';
import { setFetch } from './ai/openrouter';
import { speakingLlm, sttWords, writingChat } from './ai/fixtures';
import type { AnalysisResult } from './ai/types';
import { recoverStale, runAnalysis } from './jobs';
import { storage } from './storage';

async function speakingAttempt(extra: Partial<typeof attempts.$inferInsert> = {}) {
  const { user } = await testUser();
  const p = await seedPrompt();
  const [a] = await db
    .insert(attempts)
    .values({ userId: user.id, promptId: p.id, skill: 'speaking', part: 1, audioKey: `audio/${user.id}/x.webm`, durationMs: 3000, marks: [0, 1200], status: 'analyzing', ...extra })
    .returning();
  await storage.put(a!.audioKey!, new Uint8Array([1]), 'audio/webm');
  return a!;
}

/** Routes speaking chat calls by schema: feedback, one criterion score per call (bands fc 7, lr 6, gra 6, p 6), else the fixture. */
const speakingChat = (_: string, init: RequestInit) => {
  const body = JSON.parse(String(init.body));
  if (body.response_format?.json_schema?.name !== 'criterion_score') return chatReply(speakingLlm);
  const band = ({ fc: 7, lr: 6, gra: 6, p: 6 } as Record<string, number>)[body.messages[1].content.match(/<criterion id="(\w+)"/)[1]]!;
  return chatReply({ checks: [], evidence: [], descriptor: '', summary: '', injection: false, band });
};

it('speaking: stores analysis + mistakes, marks done, compares with parent', async () => {
  const f = fakeFetch({ '/audio/transcriptions': () => json(sttWords), '/chat/completions': speakingChat });
  setFetch(f);
  const parent = await speakingAttempt();
  await runAnalysis(parent.id);
  const child = await speakingAttempt({ userId: parent.userId, promptId: parent.promptId, parentAttemptId: parent.id });
  await db.update(analyses).set({ result: sql`jsonb_set(result, '{criteria,fc,band}', '5')` }).where(eq(analyses.attemptId, parent.id));
  await runAnalysis(child.id);

  const a = await db.query.attempts.findFirst({ where: eq(attempts.id, child.id) });
  expect(a).toMatchObject({ status: 'done', error: null });
  const an = await db.query.analyses.findFirst({ where: eq(analyses.attemptId, child.id) });
  const r = an!.result as AnalysisResult;
  expect(an).toMatchObject({ overall: 6.5, criteria: { fc: 7, lr: 6, gra: 6, p: 6 }, models: { stt: 'openai/whisper-large-v3' } });
  expect(r.questions).toEqual([
    { text: 'Where is your hometown?', startWord: 0 },
    { text: 'What do you like about it?', startWord: 2 },
  ]);
  expect(r.comparison).toEqual({ parentAttemptId: parent.id, parentOverall: 6.5, deltas: { fc: 2, lr: 0, gra: 0, p: 0 } });
  const ms = await db.select().from(mistakes).where(eq(mistakes.attemptId, child.id));
  expect(ms).toMatchObject([{ errorId: 'e0', category: 'grammar.tense', original: 'goes', correction: 'went', time: 0.5 }]);
});

it('writing: uses stored text; a failing AI marks the attempt failed with a readable error', async () => {
  const { user } = await testUser();
  const p = await seedPrompt({ skill: 'writing', part: 2, type: 'opinion' });
  const text = 'Many people has argued that technology makes life easier, and I strongly agree with this view for several reasons that I will explain in this short essay.';
  const [a] = await db.insert(attempts).values({ userId: user.id, promptId: p.id, skill: 'writing', part: 2, text, status: 'analyzing' }).returning();

  setFetch(fakeFetch({ '/chat/completions': () => chatReply('garbage') }));
  await runAnalysis(a!.id);
  expect(await db.query.attempts.findFirst({ where: eq(attempts.id, a!.id) })).toMatchObject({ status: 'failed', error: expect.stringContaining('retry') });

  setFetch(fakeFetch({ '/chat/completions': writingChat() }));
  await runAnalysis(a!.id);
  expect(await db.query.attempts.findFirst({ where: eq(attempts.id, a!.id) })).toMatchObject({ status: 'done' });
  const r = (await db.query.analyses.findFirst({ where: eq(analyses.attemptId, a!.id) }))!.result as AnalysisResult;
  expect(text.slice(r.errors[0]!.start, r.errors[0]!.end)).toBe('people has');
  expect(await db.select().from(mistakes).where(eq(mistakes.attemptId, a!.id))).toHaveLength(2);
});

it('recoverStale fails attempts analyzing for over 10 min, leaves recent and finished ones alone', async () => {
  const old = new Date(Date.now() - 11 * 60_000);
  const orphan = await speakingAttempt({ updatedAt: old });
  const running = await speakingAttempt();
  const done = await speakingAttempt({ status: 'done', updatedAt: old });
  await recoverStale();
  const status = async (id: string) => (await db.query.attempts.findFirst({ where: eq(attempts.id, id) }))!;
  expect(await status(orphan.id)).toMatchObject({ status: 'failed', error: 'Interrupted, retry' });
  expect((await status(running.id)).status).toBe('analyzing');
  expect((await status(done.id)).status).toBe('done');
});

it('live Part 1 is analysed against the examiner lines of the session; full-test P1 against the 4 asked questions', async () => {
  const f = fakeFetch({ '/audio/transcriptions': () => json(sttWords), '/chat/completions': speakingChat });
  setFetch(f);
  const questionsSent = () => JSON.parse(f.calls.findLast((c) => c.body?.response_format?.json_schema?.name === 'speaking_feedback')!.body.messages[1].content).questions;
  const five = ['q1?', 'q2?', 'q3?', 'q4?', 'q5?'];

  const a = await speakingAttempt({ mode: 'live', sessionId: crypto.randomUUID() });
  const lines = ['Let us talk about home. q1?', 'q2?', 'Now let us talk about work. w1?'];
  const history = [{ role: 'examiner', text: 'intro', phase: 'intro' }, ...lines.map((text) => ({ role: 'examiner', text, phase: 'p1' })), { role: 'examiner', text: 'p3 q', phase: 'p3' }];
  await db.insert(liveSessions).values({ id: a.sessionId!, userId: a.userId, state: { history, test: { part1: [] } } });
  await runAnalysis(a.id);
  expect(questionsSent()).toEqual(lines);

  const full = await speakingAttempt({ sessionId: crypto.randomUUID() });
  await db.update(prompts).set({ followUps: five }).where(eq(prompts.id, full.promptId));
  await runAnalysis(full.id);
  expect(questionsSent()).toEqual(five.slice(0, 4));

  const single = await speakingAttempt({ userId: full.userId, promptId: full.promptId });
  await runAnalysis(single.id);
  expect(questionsSent()).toEqual(five);
});

it('writing: an Academic Task 1 figure without chart data is sent to the model as an image', async () => {
  const { user } = await testUser();
  const p = await seedPrompt({ skill: 'writing', part: 1, variant: 'academic', type: 'bar', imageKey: 'cambridge/c1.png' });
  await storage.put('cambridge/c1.png', new Uint8Array([1, 2]), 'image/png');
  const text = 'The chart shows how people has travelled to work in three cities between 2000 and 2020, and overall car use rose while bus use fell in every city shown.';
  const [a] = await db.insert(attempts).values({ userId: user.id, promptId: p.id, skill: 'writing', part: 1, text, status: 'analyzing' }).returning();
  const f = fakeFetch({ '/models': () => json({ data: [] }), '/chat/completions': writingChat() });
  setFetch(f);
  await runAnalysis(a!.id);
  const chat = f.calls.find((c) => c.url.includes('/chat/completions'))!.body;
  expect(chat.messages[0].content).toContain('attached as an image');
  expect(chat.messages[1].content[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,AQI=' } });
});

it('out of AI credit (402): failed, not retryable, candidate-safe message; retryable again once it succeeds', async () => {
  const { user } = await testUser(undefined, { key: false }); // community user: the shared key ran dry
  const p = await seedPrompt({ skill: 'writing', part: 2, type: 'opinion' });
  const text = 'Many people has argued that technology makes life easier, and I strongly agree with this view for several reasons that I will explain in this short essay.';
  const [a] = await db.insert(attempts).values({ userId: user.id, promptId: p.id, skill: 'writing', part: 2, text, status: 'analyzing' }).returning();
  setFetch(fakeFetch({ '/chat/completions': () => json({ error: { message: 'Insufficient credits' } }, 402) }));
  await runAnalysis(a!.id);
  const row = await db.query.attempts.findFirst({ where: eq(attempts.id, a!.id) });
  expect(row).toMatchObject({ status: 'failed', errorRetryable: false, error: expect.stringContaining('try again later') });
  expect(row!.error).not.toContain('402');
  setFetch(fakeFetch({ '/chat/completions': writingChat() }));
  await runAnalysis(a!.id);
  expect(await db.query.attempts.findFirst({ where: eq(attempts.id, a!.id) })).toMatchObject({ status: 'done', errorRetryable: true });
});

it('writing: feedback is stored as `partial` (stage scoring) while the scorer still runs, and cleared when the attempt is done', async () => {
  const { user, headers } = await testUser();
  const p = await seedPrompt({ skill: 'writing', part: 2, type: 'opinion' });
  const text = `Many people has argued that technology makes life easier.\n\n${'In my view it helps us work, learn and stay in touch with family every day. '.repeat(16)}`;
  const [a] = await db.insert(attempts).values({ userId: user.id, promptId: p.id, skill: 'writing', part: 2, text, status: 'analyzing' }).returning();
  const chat = writingChat();
  let seen: { stage: string | null; partial: any } | undefined, viaApi: any;
  setFetch(
    fakeFetch({
      '/chat/completions': async (u, init) => {
        if (JSON.parse(String(init.body)).response_format?.json_schema?.name === 'writing_scores')
          for (let i = 0; i < 200 && !seen; i++) {
            const row = await db.query.attempts.findFirst({ where: eq(attempts.id, a!.id) });
            if (row?.partial && row.stage === 'scoring') {
              seen = { stage: row.stage, partial: row.partial };
              viaApi = await (await req(`/api/attempts/${a!.id}`, { headers })).json();
            } else await new Promise((r) => setTimeout(r, 20));
          }
        return chat(u, init);
      },
    }),
  );
  await runAnalysis(a!.id);
  expect(seen).toMatchObject({ stage: 'scoring', partial: { skill: 'writing', topFixes: expect.any(Array), errors: expect.any(Array), rewrite: { text: 'Better essay.' } } });
  expect(seen!.partial.topFixes).toHaveLength(3);
  expect(viaApi).toMatchObject({ status: 'analyzing', stage: 'scoring', partial: { rewrite: { text: 'Better essay.' } }, analysis: null });
  const done = await db.query.attempts.findFirst({ where: eq(attempts.id, a!.id) });
  expect(done).toMatchObject({ status: 'done', stage: null, partial: null });
  const r = (await db.query.analyses.findFirst({ where: eq(analyses.attemptId, a!.id) }))!.result as AnalysisResult;
  expect(r.timings).toMatchObject({ feedbackMs: expect.any(Number), scorerMs: expect.any(Number), calibrationMs: expect.any(Number) });
});
