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
