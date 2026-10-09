// OpenAI Realtime (gpt-realtime family) as a live examiner, for comparison with GPT-Live and Gemini Live. The server mints a short-lived client secret with
// the examiner session locked in (model, voice, instructions, VAD, input transcription); the browser connects over WebRTC with it.
// Docs: platform.openai.com/docs/guides/realtime-webrtc, /api-reference/realtime-sessions/create-realtime-client-secret.
import type { SpeakingTest } from '../routes/prompts';
import { realtimeInstructions } from './examiner';

export const REALTIME_MODELS = ['gpt-realtime-mini', 'gpt-realtime'] as const;
export type RealtimeModel = (typeof REALTIME_MODELS)[number];
const VOICE = 'cedar';
const TRANSCRIBE_MODEL = 'gpt-4o-mini-transcribe';

/** The session the secret locks: the same plan and cue convention as Gemini Live (realtimeInstructions), server VAD tolerant of thinking pauses. */
export const realtimeSession = (model: RealtimeModel, t: SpeakingTest) => ({
  type: 'realtime',
  model,
  instructions: realtimeInstructions(t),
  audio: {
    input: {
      transcription: { model: TRANSCRIBE_MODEL, language: 'en' },
      turn_detection: { type: 'server_vad', silence_duration_ms: 1000, prefix_padding_ms: 300 },
    },
    output: { voice: VOICE },
  },
});

export async function mintRealtimeSecret(apiKey: string, model: RealtimeModel, t: SpeakingTest): Promise<{ value: string; expiresAt: number } | { status: number; detail: string }> {
  const res = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expires_after: { anchor: 'created_at', seconds: 600 }, session: realtimeSession(model, t) }),
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  if (!res?.ok) return { status: res?.status ?? 0, detail: (await res?.text().catch(() => ''))?.slice(0, 500) ?? '' };
  const d = (await res.json()) as { value?: string; expires_at?: number };
  return d.value ? { value: d.value, expiresAt: d.expires_at ?? 0 } : { status: 502, detail: 'no client secret in the response' };
}

/** Token totals of a Realtime session, summed over response.done usage (input counts re-read context, as billed). */
export type RealtimeUsage = { textIn: number; audioIn: number; cachedIn: number; textOut: number; audioOut: number; transcribeSeconds: number };
/** USD per 1M tokens. ponytail: OpenAI list prices as of 2025; check platform.openai.com/docs/pricing and update here. */
const PER_M: Record<RealtimeModel, { textIn: number; audioIn: number; cachedIn: number; textOut: number; audioOut: number }> = {
  'gpt-realtime': { textIn: 4, audioIn: 32, cachedIn: 0.4, textOut: 16, audioOut: 64 },
  'gpt-realtime-mini': { textIn: 0.6, audioIn: 10, cachedIn: 0.3, textOut: 2.4, audioOut: 20 },
};
const TRANSCRIBE_PER_MIN = 0.003; // gpt-4o-mini-transcribe, the candidate's input transcription
export const realtimeUsd = (model: RealtimeModel, u: RealtimeUsage) => {
  const p = PER_M[model];
  return (u.textIn * p.textIn + u.audioIn * p.audioIn + u.cachedIn * p.cachedIn + u.textOut * p.textOut + u.audioOut * p.audioOut) / 1e6 + (u.transcribeSeconds / 60) * TRANSCRIBE_PER_MIN;
};
