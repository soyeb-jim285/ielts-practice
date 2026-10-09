// Gemini Live wire format (ai.google.dev/api/live): the messages we send and a parser that turns server messages into a few events.
import { toBase64 } from './pcm';

/** Ephemeral tokens connect to the "Constrained" endpoint, on v1beta, with the token as access_token. */
export const geminiUrl = (token: string) =>
  `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=${token}`;

/** Same prefix the server's instructions tell the model to treat as an app cue (ai/examiner.ts CUE_PREFIX). */
export const CUE_PREFIX = '[APP CUE] ';

/** First message. Model, voice, instructions, VAD, transcription and compression are locked into the token on the server; only resumption is ours. */
export const setupMessage = (model: string, handle?: string) => ({ setup: { model: `models/${model}`, sessionResumption: handle ? { handle } : {} } });

export const audioMessage = (pcm16le: Uint8Array) => ({ realtimeInput: { audio: { data: toBase64(pcm16le), mimeType: 'audio/pcm;rate=16000' } } });

/** Flushes cached audio when the mic stops streaming (docs: send after the stream pauses for more than a second). */
export const audioEndMessage = () => ({ realtimeInput: { audioStreamEnd: true } });

/** An instruction from the app. turnComplete: true interrupts whatever the examiner is saying and makes it answer now (Gemini 3.8 Live). */
export const cueMessage = (text: string) => ({ clientContent: { turns: [{ role: 'user', parts: [{ text: CUE_PREFIX + text }] }], turnComplete: true } });

export type GeminiEvent =
  | { type: 'setupComplete' }
  | { type: 'audio'; data: string }
  | { type: 'outText'; text: string }
  | { type: 'inText'; text: string }
  | { type: 'interrupted' }
  | { type: 'generationComplete' }
  | { type: 'turnComplete' }
  | { type: 'goAway'; timeLeftMs: number }
  | { type: 'resume'; handle: string };

type Part = { inlineData?: { data?: string; mimeType?: string } };
type ServerMessage = {
  setupComplete?: object;
  serverContent?: {
    modelTurn?: { parts?: Part[] };
    inputTranscription?: { text?: string };
    outputTranscription?: { text?: string };
    interrupted?: boolean;
    generationComplete?: boolean;
    turnComplete?: boolean;
  };
  goAway?: { timeLeft?: string };
  sessionResumptionUpdate?: { newHandle?: string; resumable?: boolean };
};

/** protobuf Duration JSON ("50s", "1.5s") → ms */
const durationMs = (d?: string) => Math.round(parseFloat(d ?? '0') * 1000) || 0;

/** One server message → events, in the order the app should act on them (an interruption first, so audio after it is the new answer). */
export function parseGeminiMessage(m: ServerMessage): GeminiEvent[] {
  const out: GeminiEvent[] = [];
  if (m.setupComplete) out.push({ type: 'setupComplete' });
  const c = m.serverContent;
  if (c) {
    if (c.interrupted) out.push({ type: 'interrupted' });
    if (c.inputTranscription?.text) out.push({ type: 'inText', text: c.inputTranscription.text });
    for (const p of c.modelTurn?.parts ?? []) if (p.inlineData?.data && /^audio\//.test(p.inlineData.mimeType ?? 'audio/')) out.push({ type: 'audio', data: p.inlineData.data });
    if (c.outputTranscription?.text) out.push({ type: 'outText', text: c.outputTranscription.text });
    if (c.generationComplete) out.push({ type: 'generationComplete' });
    if (c.turnComplete) out.push({ type: 'turnComplete' });
  }
  if (m.goAway) out.push({ type: 'goAway', timeLeftMs: durationMs(m.goAway.timeLeft) });
  const r = m.sessionResumptionUpdate;
  if (r?.resumable && r.newHandle) out.push({ type: 'resume', handle: r.newHandle });
  return out;
}

/** WebSocket frames arrive as text or, in some browsers, Blob/ArrayBuffer. */
export async function frameText(data: unknown): Promise<string> {
  if (typeof data === 'string') return data;
  if (data instanceof Blob) return data.text();
  return new TextDecoder().decode(data as ArrayBuffer);
}

/** Token totals of a session, summed over replies (each reply's usageMetadata re-counts the context it read; Google bills it that way). Gemini returns no cost. */
export type GeminiUsage = { inputText: number; inputAudio: number; inputMedia: number; outputText: number; outputAudio: number; thoughts: number };
export const emptyUsage = (): GeminiUsage => ({ inputText: 0, inputAudio: 0, inputMedia: 0, outputText: 0, outputAudio: 0, thoughts: 0 });
type Detail = { modality?: string; tokenCount?: number };
type UsageMetadata = { promptTokensDetails?: Detail[]; responseTokensDetails?: Detail[]; thoughtsTokenCount?: number };
/** Adds one server message's usageMetadata (if any) to `total`, in place. */
export function addUsage(total: GeminiUsage, u: UsageMetadata | undefined) {
  if (!u) return total;
  const add = (ds: Detail[] | undefined, side: 'input' | 'output') => {
    for (const d of ds ?? []) {
      const n = Math.max(0, Math.round(d.tokenCount ?? 0)), m = (d.modality ?? '').toUpperCase();
      if (m === 'AUDIO') total[`${side}Audio`] += n;
      else if (side === 'input' && (m === 'IMAGE' || m === 'VIDEO')) total.inputMedia += n;
      else total[`${side}Text`] += n;
    }
  };
  add(u.promptTokensDetails, 'input');
  add(u.responseTokensDetails, 'output');
  total.thoughts += Math.max(0, Math.round(u.thoughtsTokenCount ?? 0));
  return total;
}
