// Gemini Live (Gemini 3.8 Live over WebSocket): the setup an ephemeral token is locked to, and the token request.
// Docs: ai.google.dev/gemini-api/docs/live-api (+ /ephemeral-tokens, /session-management), ai.google.dev/api/live.
import type { SpeakingTest } from '../routes/prompts';
import { realtimeInstructions } from './examiner';

export const GEMINI_VOICE = 'Charon'; // same prebuilt voice set as the Gemini TTS the turn-based examiner uses
const TOKEN_MS = 20 * 60_000; // first connect and reconnects (sessionResumption) must happen within this window

type Json = Record<string, unknown>;

/** The BidiGenerateContentSetup the token locks: model, voice, examiner instructions, VAD, transcriptions and compression.
 *  sessionResumption is deliberately not locked: the client sets it (with a handle) to reconnect before the ~10 min connection limit. */
export function geminiSetup(model: string, t: SpeakingTest): Json {
  return {
    model: `models/${model}`,
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: GEMINI_VOICE } } },
    },
    systemInstruction: { parts: [{ text: realtimeInstructions(t) }] },
    realtimeInputConfig: {
      // Low sensitivity + ~1 s of silence: candidates pause to think, and the examiner must not jump in. Barge-in stays on.
      automaticActivityDetection: { startOfSpeechSensitivity: 'START_SENSITIVITY_LOW', endOfSpeechSensitivity: 'END_SENSITIVITY_LOW', prefixPaddingMs: 100, silenceDurationMs: 1000 },
      activityHandling: 'START_OF_ACTIVITY_INTERRUPTS',
    },
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    contextWindowCompression: { slidingWindow: {} }, // audio-only sessions stop at 15 min without it
  };
}

/** Field mask of the locked fields, built like the official SDK does (top-level key, or "key.child" one level down). */
export function lockMask(setup: Json): string {
  return Object.entries(setup)
    .flatMap(([k, v]) => {
      const kids = typeof v === 'object' && v !== null ? Object.keys(v) : [];
      return kids.length ? kids.map((c) => `${k}.${c}`) : [k];
    })
    .join(',');
}

/** POST /v1beta/auth_tokens body (AuthToken): a single-use token locked to our setup. */
export function geminiTokenRequest(model: string, t: SpeakingTest, now = Date.now()) {
  const setup = geminiSetup(model, t);
  const expireTime = new Date(now + TOKEN_MS).toISOString();
  return { uses: 1, expireTime, newSessionExpireTime: expireTime, bidiGenerateContentSetup: setup, fieldMask: lockMask(setup) };
}

/** Mints the token. v1beta is current; v1alpha is tried on 404 for accounts or SDK versions still on the older surface. */
export async function mintGeminiToken(apiKey: string, body: unknown): Promise<{ name: string; expireTime?: string } | { status: number; detail: string }> {
  let last = { status: 0, detail: '' };
  for (const v of ['v1beta', 'v1alpha']) {
    const res = await fetch(`https://generativelanguage.googleapis.com/${v}/auth_tokens`, {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    }).catch(() => null);
    if (res?.ok) return (await res.json()) as { name: string; expireTime?: string };
    last = { status: res?.status ?? 0, detail: (await res?.text().catch(() => ''))?.slice(0, 500) ?? '' };
    if (res?.status !== 404) break;
  }
  return last;
}
