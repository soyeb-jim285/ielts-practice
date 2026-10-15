/** Public playground configuration only. Provider credentials never belong here. */
export type LiveKitPartConfig = {
  stt: 'soniox' | 'elevenlabs';
  sttModel: 'stt-rt-v5' | 'scribe_v2_realtime';
  llm: 'openai/gpt-6-luna' | 'deepseek/deepseek-v4.1-flash';
  tts: 'soniox' | 'cartesia' | 'elevenlabs' | 'inworld' | 'gradium';
  ttsModel: string;
  voice: string;
  /** Local semantic audio model, or silence-only VAD. Part 2 always keeps application-owned floor control. */
  turnDetection: 'audio' | 'vad';
  /** Endpoint bounds in seconds, not an end-to-end response latency target. */
  minEndpointDelay: number;
  maxEndpointDelay: number;
  vadSilence: number;
  interruptions: boolean;
  preemptiveGeneration: boolean;
  temperature: number;
  maxTokens: number;
};

/** Overrides are resolved at part boundaries; credentials are checked for every effective part before dispatch. */
export type LiveKitConfig = LiveKitPartConfig & { parts?: Partial<Record<'1' | '2' | '3', Partial<LiveKitPartConfig>>> };

export const LIVEKIT_TTS_MODELS = {
  soniox: ['tts-rt-v2'],
  cartesia: ['sonic-3.6', 'sonic-3.5'],
  elevenlabs: ['eleven_flash_v2_5', 'eleven_turbo_v2_5'],
  inworld: ['inworld-tts-2-flash', 'inworld-tts-2'],
  gradium: ['gradium-tts-beta', 'default'],
} as const;

export const DEFAULT_LIVEKIT: LiveKitConfig = {
  stt: 'soniox', sttModel: 'stt-rt-v5',
  llm: 'deepseek/deepseek-v4.1-flash',
  tts: 'soniox', ttsModel: 'tts-rt-v2', voice: 'Adrian',
  turnDetection: 'audio', minEndpointDelay: 0.5, maxEndpointDelay: 4,
  vadSilence: 0.3, interruptions: true, preemptiveGeneration: false,
  temperature: 0.5, maxTokens: 200,
};

export function livekitPartConfig(cfg: LiveKitConfig, part: '1' | '2' | '3'): LiveKitPartConfig {
  const { parts, ...base } = cfg;
  return { ...base, ...parts?.[part] };
}


// The cue texts a duplex examiner may receive from the client. They live here because the server hands the exact list to the LiveKit worker,
// which refuses any other text: the worker's LLM runs on the server's key, so it must not take free text from the browser.
export const DUPLEX_PART: Record<string, string> = { intro: 'the introduction', p1: 'Part 1', 'p2-follow': 'the end of Part 2', p3: 'Part 3' };
const NEXT: Record<string, string> = {
  intro: 'if they have answered your last introduction question, ask the next one or, after the last, start Part 1 with its first question; otherwise ask it again',
  p1: 'ask your next Part 1 question',
  'p2-follow': 'if they have answered the rounding-off question, start Part 3 with its first question; otherwise ask the rounding-off question again',
  p3: 'ask your next Part 3 question',
};
/** The app message for a nudge: where the test is and the one thing to do now. */
export const nudgeText = (phase: string, a: 'continue' | 'repeat') =>
  a === 'repeat'
    ? `You are in ${DUPLEX_PART[phase] ?? 'the test'}. The candidate has not answered. Repeat your last question once, in the same words, then wait.`
    : `You are in ${DUPLEX_PART[phase] ?? 'the test'}. The candidate is waiting for you. Continue now: ${NEXT[phase] ?? 'ask your next question'}. One question, and do not move to another part.`;
export const CUE_TEXT = {
  part2: 'Part 1 is over. Move to Part 2 now: give the Part 2 instructions and the topic, then stay silent while the candidate prepares.',
  talk: 'The preparation minute is over. Ask the candidate to start speaking now, then stay silent until you are told the talk is over.',
  'follow-timeup': `The two minutes are up. Say "Thank you. That's the end of your time." and ask the rounding-off question.`,
  follow: 'The candidate has finished their talk. Say "Thank you." and ask the rounding-off question.',
  closing: 'The test is over. Say the closing line now and nothing more.',
} as const;
/** Every cue text the client can send (nudges only fire in DUPLEX_PART phases). */
export const duplexCueTexts = () => [...Object.values(CUE_TEXT), ...Object.keys(DUPLEX_PART).flatMap((p) => [nudgeText(p, 'continue'), nudgeText(p, 'repeat')])];
