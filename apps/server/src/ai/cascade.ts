// Fast cascade examiner (admin playground): the browser streams the mic to an OpenAI Realtime *transcription* session (server VAD + gpt-4o-mini-transcribe,
// $0.003/min), and each finished answer goes to /live/cascade/reply: a cheap OpenRouter LLM writes the next line from the same plan and cue convention
// as the duplex examiners (realtimeInstructions), and an OpenRouter TTS voices it. The app owns the script, so the model can't decide to wait.
// Docs: developers.openai.com/api/reference/resources/realtime/subresources/client_secrets/methods/create, /docs/guides/realtime-transcription.
import type { SpeakingTest } from '../routes/prompts';
import { CUE_PREFIX, realtimeInstructions } from './examiner';

/** Reasoning off: measured 2026-10-13 for a one-line reply, DeepSeek V4.1 Flash 0.9-2.3 s, Luna 1.1-2.1 s (3-4 s with low effort). */
export const CASCADE_LLMS = ['deepseek/deepseek-v4.1-flash', 'openai/gpt-6-luna'] as const;
/** TTS model → its examiner voice. Measured for a 10-word line: ElevenLabs Flash ~1.0 s, Gemini TTS 2.5-3.3 s (Kokoro on OpenRouter took 31-35 s, dropped).
 *  Prices per OpenRouter's catalogue, 2026-10-13. */
export const CASCADE_TTS = {
  'elevenlabs/eleven-flash-v2.5': 'george',
  'google/gemini-3.8-flash-lite-tts': 'Charon',
  'google/gemini-3.8-flash-tts': 'Charon',
} as const;
export type CascadeTts = keyof typeof CASCADE_TTS;
export const CASCADE_TTS_MODELS = Object.keys(CASCADE_TTS) as [CascadeTts, ...CascadeTts[]];
export const CASCADE_STT = 'gpt-4o-mini-transcribe';

/** The transcription session the client secret locks: VAD as tolerant of thinking pauses as the realtime examiner's, so the engines compare fairly. */
export const transcriptionSession = () => ({
  type: 'transcription',
  audio: {
    input: {
      noise_reduction: { type: 'near_field' },
      transcription: { model: CASCADE_STT, language: 'en' },
      turn_detection: { type: 'server_vad', silence_duration_ms: 1000, prefix_padding_ms: 300 },
    },
  },
});

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

/** What the voice should say: drops a speaker label, wrapping quotes and markdown the model added anyway. */
export const spokenLine = (raw: string) =>
  raw
    .replace(/[*_#`]/g, '')
    .replace(/^\s*(examiner|alex)\s*:\s*/i, '')
    .trim()
    .replace(/^"([^"]*)"$/, '$1')
    .trim();
