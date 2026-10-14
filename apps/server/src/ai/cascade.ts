// Fast cascade examiner (admin playground): the browser streams the candidate's speech (local VAD: only while they talk) to ElevenLabs Scribe v2 Realtime
// and commits each answer itself; each finished answer goes to /live/cascade/reply: a cheap OpenRouter LLM writes the next line from the same plan and cue
// convention as the duplex examiners (realtimeInstructions), and an OpenRouter TTS voices it. The app owns the script, so the model can't decide to wait.
// Docs: elevenlabs.io/docs/api-reference/speech-to-text/v-1-speech-to-text-realtime, /docs/api-reference/tokens/create.
import type { SpeakingTest } from '../routes/prompts';
import { CUE_PREFIX, EXAMINER_NAMES, realtimeInstructions } from './examiner';

/** Reasoning off, one examiner line, measured 2026-10-14: DeepSeek V4.1 Flash 0.8-1.6 s, Mercury 2.5 1.0-2.3 s ($0.04/$0.15 per M), Mistral Small 3.2
 *  1.3-2.4 s ($0.09/$0.25), Luna 1.5-2.6 s. Dropped: Gemini 2.5 Flash-Lite and Llama 4 Maverick (~3 s); gpt-oss, GLM 5.3 Flash, gpt-5-nano and Gemini 3.5
 *  Flash-Lite refuse reasoning off. */
export const CASCADE_LLMS = ['deepseek/deepseek-v4.1-flash', 'inception/mercury-2.5', 'mistralai/mistral-small-3.2-24b-instruct', 'openai/gpt-6-luna'] as const;
/** TTS model → its examiner voice. Measured 2026-10-13 for a short line: ElevenLabs v4 Turbo 1.1-1.2 s (10 s cold), Flash 0.6-1.0 s, Gemini TTS 2.5-3.3 s
 *  (Kokoro on OpenRouter took 31-35 s, dropped). v4 Turbo and Flash are both $20/M characters on OpenRouter. */
export const CASCADE_TTS = {
  'elevenlabs/eleven-v4-turbo': 'george',
  'elevenlabs/eleven-flash-v2.5': 'george',
  'google/gemini-3.8-flash-lite-tts': 'Charon',
  'google/gemini-3.8-flash-tts': 'Charon',
} as const;
export type CascadeTts = keyof typeof CASCADE_TTS;
export const CASCADE_TTS_MODELS = Object.keys(CASCADE_TTS) as [CascadeTts, ...CascadeTts[]];
/** Streaming transcribers. Scribe: the browser sends only the candidate's speech (local VAD) and commits each answer; OpenAI: a Realtime transcription
 *  session over WebRTC with server VAD. USD per minute of transcribed audio (elevenlabs.io/pricing/api, developers.openai.com pricing, 2026-10-13). */
export const CASCADE_STTS = {
  scribe_v2_realtime: { provider: 'elevenlabs', usdPerMin: 0.39 / 60 },
  'gpt-4o-mini-transcribe': { provider: 'openai', usdPerMin: 0.003 },
  'gpt-4o-transcribe': { provider: 'openai', usdPerMin: 0.006 },
} as const;
export type CascadeStt = keyof typeof CASCADE_STTS;
export const CASCADE_STT_MODELS = Object.keys(CASCADE_STTS) as [CascadeStt, ...CascadeStt[]];

/** The OpenAI transcription session a client secret locks: VAD as tolerant of thinking pauses as the realtime examiner's, so the engines compare fairly. */
export const transcriptionSession = (model: CascadeStt) => ({
  type: 'transcription',
  audio: {
    input: {
      noise_reduction: { type: 'near_field' },
      transcription: { model, language: 'en' },
      turn_detection: { type: 'server_vad', silence_duration_ms: 1000, prefix_padding_ms: 300 },
    },
  },
});

/** A single-use token (15 min to connect) for one Scribe v2 Realtime socket from the browser. */
export async function scribeToken(apiKey: string): Promise<{ token: string } | { status: number; detail: string }> {
  const res = await fetch('https://api.elevenlabs.io/v1/single-use-token/realtime_scribe', { method: 'POST', headers: { 'xi-api-key': apiKey }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return { status: res.status, detail: (await res.text()).slice(0, 300) };
  return { token: ((await res.json()) as { token: string }).token };
}

export type CascadeTurn = { role: 'examiner' | 'candidate' | 'app'; text: string };

/** Chat messages for the next examiner line: the duplex plan, plus the rules a text-to-speech voice needs. */
export function cascadeMessages(t: SpeakingTest, turns: CascadeTurn[]) {
  const system = `${realtimeInstructions(t)}

Your reply is read aloud by a text-to-speech voice. Reply with only the words you say, as plain sentences: no labels, stage directions, quotes around the reply, markdown or emojis. If you must stay silent, reply with nothing.`;
  return [
    { role: 'system' as const, content: system },
    ...turns.map((x) => (x.role === 'examiner' ? { role: 'assistant' as const, content: x.text } : { role: 'user' as const, content: x.role === 'app' ? CUE_PREFIX + x.text : x.text })),
  ];
}

const LABEL = new RegExp(`^\\s*(examiner|${EXAMINER_NAMES.join('|')})\\s*:\\s*`, 'i');
/** What the voice should say: drops a speaker label ("Examiner:" or any examiner name), wrapping quotes and markdown the model added anyway. */
export const spokenLine = (raw: string) =>
  // a reply that talks about the app's cue is the model's reasoning leaking out (seen from Luna with reasoning off): say nothing, the watchdog nudges again
  /\bAPP CUE\b/i.test(raw)
    ? ''
    : raw
        .replace(/[*_#`]/g, '')
        .replace(LABEL, '')
        .trim()
        .replace(/^"([^"]*)"$/, '$1')
        .trim();
