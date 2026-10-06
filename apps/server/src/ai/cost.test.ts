import { chatReply, fakeFetch, json } from '../test/helpers'; // first: loads the app before the modules that import it back
import { asc } from 'drizzle-orm';
import { expect, it, vi } from 'vitest';
import { db } from '../db/client';
import { aiCosts } from '../db/schema';
import { env } from '../env';
import { asRetry, flushCosts, recordCost, usageCost } from './cost';
import { keyCtx } from './keyctx';
import { chatJson, chatText, setFetch, speak, transcribe } from './openrouter';
import { analyzeSpeaking } from './speaking';
import { analyzeWriting } from './writing';
import { settings, speakingLlm, sttWords, writingChat } from './fixtures';
import { z } from 'zod';

const ctx = { userId: 'u1', attemptId: 'a1', sessionId: 's1', promptId: 'p1', skill: 'speaking' as const, part: 2 };
const all = async () => (await flushCosts(), await db.select().from(aiCosts).orderBy(asc(aiCosts.createdAt)));
/** Adds an OpenRouter `usage` block (what `usage: {include: true}` returns) to a chat reply. */
const withUsage = (route: (u: string, i: RequestInit) => Response | Promise<Response>, cost = 0.01) => async (u: string, i: RequestInit) =>
  json({ ...((await (await route(u, i)).json()) as object), id: 'gen-1', provider: 'Acme', usage: { prompt_tokens: 100, completion_tokens: 20, cost } });

it('recordCost writes one row from the request context: payer, owner, attempt', async () => {
  keyCtx.run({ openrouter: 'sk-own', cost: ctx }, () => recordCost({ stage: 'score', provider: 'openrouter', model: 'm', costUsd: 0.0123456 }));
  recordCost({ stage: 'live_realtime', provider: 'openai', model: 'gpt-live-1', costUsd: 1, userId: 'u2', sessionId: 's2', paidBy: 'own_key' });
  const [a, b] = await all();
  expect(a).toMatchObject({ userId: 'u1', attemptId: 'a1', sessionId: 's1', promptId: 'p1', skill: 'speaking', part: 2, stage: 'score', paidBy: 'own_key', costUsd: 0.012346, ok: true, retry: false });
  expect(b).toMatchObject({ userId: 'u2', attemptId: null, paidBy: 'own_key', provider: 'openai' });
});

it('recordCost never throws or rejects into the caller when the database fails', async () => {
  const spy = vi.spyOn(db, 'insert');
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  spy.mockImplementationOnce(() => { throw new Error('boom sync'); });
  spy.mockImplementationOnce(() => Promise.reject(new Error('boom async')) as never);
  expect(() => recordCost({ stage: 'x', provider: 'openrouter', model: 'm', costUsd: 1 })).not.toThrow();
  expect(() => recordCost({ stage: 'x', provider: 'openrouter', model: 'm', costUsd: 1 })).not.toThrow();
  await flushCosts();
  expect(err).toHaveBeenCalledTimes(2);
  spy.mockRestore();
  err.mockRestore();
  expect(await all()).toHaveLength(0);
});

it('usageCost sums the BYOK upstream cost and reports whether the cost was exact', () => {
  const u = { prompt_tokens: 5, completion_tokens: 2, cost: 0.01, cost_details: { upstream_inference_cost: 0.04 } };
  expect(keyCtx.run({ openrouter: 'sk-own-key' }, () => usageCost(u))).toMatchObject({ costUsd: 0.05, inputTokens: 5, outputTokens: 2, exact: true });
  expect(usageCost(u).costUsd).toBe(0.01); // house key: upstream cost is already inside `cost`
  expect(usageCost(undefined)).toMatchObject({ costUsd: 0, exact: false });
});

it('chat calls ask for usage and record the exact cost, served provider and generation id; chatText defaults to the examiner stage', async () => {
  const f = fakeFetch({ '/chat/completions': withUsage(() => chatReply('Hello'), 0.0042) });
  setFetch(f);
  await keyCtx.run({ cost: ctx }, () => chatText({ model: 'm/x', messages: [{ role: 'user', content: 'hi' }] }));
  expect(f.calls[0]!.body.usage).toEqual({ include: true });
  const [r] = await all();
  expect(r).toMatchObject({ stage: 'examiner_llm', provider: 'openrouter', model: 'm/x', costUsd: 0.0042, inputTokens: 100, outputTokens: 20, paidBy: 'house', attemptId: 'a1' });
  expect(r!.meta).toMatchObject({ generationId: 'gen-1', served: 'Acme' });
  expect(r!.meta).not.toHaveProperty('estimated');
});

it('a response without usage is recorded as an estimated zero; a failed call as ok=false; a JSON re-ask as a retry', async () => {
  const S = z.object({ a: z.number() });
  let n = 0;
  setFetch(fakeFetch({ '/chat/completions': withUsage(() => chatReply(++n === 1 ? 'not json' : { a: 1 }), 0.003) }));
  await keyCtx.run({ cost: ctx }, () => chatJson({ model: 'm', system: 's', user: 'u', schema: S, schemaName: 'x', cost: { stage: 'feedback' } }));
  setFetch(fakeFetch({ '/chat/completions': () => json({ choices: [{ message: { content: 'x' } }] }) }));
  await keyCtx.run({ cost: ctx }, () => chatText({ model: 'm', messages: [] }));
  setFetch(fakeFetch({ '/chat/completions': () => new Response('no', { status: 402 }) }));
  await keyCtx.run({ cost: ctx }, () => chatText({ model: 'm', messages: [] }).catch(() => {}));
  const rows = (await all()).sort((a, b) => Number(a.stage === 'examiner_llm') - Number(b.stage === 'examiner_llm') || Number(a.retry) - Number(b.retry) || Number(b.ok) - Number(a.ok)); // the write order of concurrent ledger inserts is not part of the contract
  expect(rows.map((r) => [r.stage, r.retry, r.ok, r.costUsd])).toEqual([['feedback', false, true, 0.003], ['feedback', true, true, 0.003], ['examiner_llm', false, true, 0], ['examiner_llm', false, false, 0]]);
  expect(rows[2]!.meta).toMatchObject({ estimated: true });
  expect(rows[3]!.meta).toMatchObject({ status: 402, code: 'http' });
});

it('asRetry marks everything inside as a retry', async () => {
  await keyCtx.run({ cost: ctx }, () => asRetry(async () => recordCost({ stage: 'x', provider: 'openrouter', model: 'm', costUsd: 1 })));
  expect((await all())[0]).toMatchObject({ retry: true, attemptId: 'a1' });
});

it('speaking pipeline: STT (plain + primed, kept flag), no audio review, feedback, every scorer sample', async () => {
  const score = { checks: [], evidence: [], descriptor: 'd', summary: 's', injection: false, band: 6 };
  const chat = (_: string, init: RequestInit) => {
    const name = JSON.parse(String(init.body)).response_format?.json_schema?.name;
    return name === 'speaking_feedback' ? chatReply(speakingLlm) : name === 'disfluency_tags' ? chatReply({ tags: [] }) : chatReply(score);
  };
  setFetch(fakeFetch({ '/audio/transcriptions': () => json({ ...sttWords, usage: { cost: 0.002 } }), '/chat/completions': withUsage(chat, 0.01) }));
  await keyCtx.run({ cost: ctx }, () => analyzeSpeaking({ audio: new Uint8Array([1, 2]), format: 'webm', durationMs: 3000, questions: ['Q?'], part: 2, settings: settings({ models: { ...settings().models, stt: 'openai/whisper-large-v3' } }) }));
  const rows = await all();
  const by = (stage: string) => rows.filter((r) => r.stage === stage);
  expect(by('stt')).toHaveLength(1);
  expect(by('stt_verbatim')).toHaveLength(1);
  expect(by('stt')[0]).toMatchObject({ costUsd: 0.002, model: 'openai/whisper-large-v3' });
  expect(typeof by('stt_verbatim')[0]!.meta!.kept).toBe('boolean');
  expect(by('feedback')).toHaveLength(1);
  expect(by('disfluency')).toHaveLength(1);
  const scores = by('score');
  expect(scores).toHaveLength(12); // 4 criteria (no pronunciation pass) x 3 samples
  expect(new Set(scores.map((r) => `${r.meta!.criterion}${r.meta!.sample}`)).size).toBe(12);
  expect(scores.every((r) => r.costUsd === 0.01 && r.attemptId === 'a1' && r.part === 2)).toBe(true);
});

it('Scribe: house-paid ElevenLabs row from audio seconds, a failed call as ok=false and the Whisper fallback tagged', async () => {
  (env as { ELEVENLABS_API_KEY?: string }).ELEVENLABS_API_KEY = 'xi-test';
  const words = [{ text: 'hello', start: 0, end: 36, type: 'word' }];
  setFetch(fakeFetch({ elevenlabs: () => json({ words }) }));
  await keyCtx.run({ cost: ctx }, () => transcribe({ model: 'elevenlabs/scribe_v2', audio: new Uint8Array([1]), format: 'webm' }));
  setFetch(fakeFetch({ elevenlabs: () => new Response('no', { status: 500 }), '/audio/transcriptions': () => json({ text: 'hi', duration: 3600, words: [{ word: 'hi', start: 0, end: 1 }] }) }));
  await keyCtx.run({ cost: ctx }, () => transcribe({ model: 'elevenlabs/scribe_v2', audio: new Uint8Array([1]), format: 'webm' }));
  (env as { ELEVENLABS_API_KEY?: string }).ELEVENLABS_API_KEY = undefined;
  const rows = await all(); // inserts race, so pick by what they are, not by order
  const ok = rows.find((r) => r.provider === 'elevenlabs' && r.ok), failed = rows.find((r) => r.provider === 'elevenlabs' && !r.ok), fallback = rows.find((r) => r.provider === 'openrouter');
  expect(ok).toMatchObject({ provider: 'elevenlabs', ok: true, audioSeconds: 36, paidBy: 'house' });
  expect(ok!.costUsd).toBeCloseTo((36 / 3600) * env.ELEVENLABS_SCRIBE_USD_PER_HOUR, 6);
  expect(failed).toMatchObject({ provider: 'elevenlabs', ok: false, costUsd: 0 });
  expect(fallback).toMatchObject({ provider: 'openrouter', stage: 'stt', ok: true });
  expect(fallback!.meta).toMatchObject({ fallbackFrom: 'elevenlabs/scribe_v2', estimated: true });
});

it('TTS: one estimated row per synthesised chunk with its characters', async () => {
  setFetch(fakeFetch({ '/audio/speech': () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'audio/mpeg' } }) }));
  await keyCtx.run({ cost: ctx }, () => speak({ model: 'openai/tts', voice: 'alloy', text: 'Hello there.' }));
  const [r] = await all();
  expect(r).toMatchObject({ stage: 'examiner_tts', characters: 12 });
  expect(r!.meta).toMatchObject({ estimated: true });
});

it('writing: the feedback call and every scoring sample leave a row with the mocked usage.cost', async () => {
  setFetch(fakeFetch({ '/chat/completions': withUsage(writingChat(), 0.02) }));
  const essay = `Many people has argued that technology makes life easier.\n\n${'In my view it helps us work, learn and stay in touch with family every day. '.repeat(16)}`;
  await keyCtx.run({ cost: { ...ctx, skill: 'writing' } }, () => analyzeWriting({ text: essay, task: 2, variant: 'academic', prompt: { title: 'T', body: 'Discuss.' }, settings: settings({ models: { ...settings().models, analysis: 'other/model' } }) }));
  await flushCosts();
  const done = await all();
  expect(done.filter((r) => r.stage === 'feedback')).toHaveLength(1);
  expect(done.filter((r) => r.stage === 'score').length).toBeGreaterThanOrEqual(3);
  expect(done.every((r) => r.costUsd === 0.02 && r.skill === 'writing')).toBe(true);
});

it('a billed primed transcription is recorded even when the plain pass fails', async () => {
  setFetch(fakeFetch({ '/audio/transcriptions': (_u, init) => (String((init as RequestInit).body).includes('"provider"') ? json({ ...sttWords, usage: { cost: 0.002 } }) : new Response('no', { status: 500 })) }));
  await keyCtx.run({ cost: ctx }, () => transcribe({ model: 'openai/whisper-large-v3', audio: new Uint8Array([1]), format: 'webm', verbatim: true })).catch(() => {});
  const rows = await all();
  expect(rows.some((r) => r.stage === 'stt_verbatim' && r.ok && r.costUsd === 0.002)).toBe(true);
});
