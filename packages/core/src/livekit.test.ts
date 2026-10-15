import { describe, expect, it } from 'vitest';
import { DEFAULT_LIVEKIT, LIVEKIT_TTS_MODELS, livekitPartConfig } from './livekit';

describe('LiveKit playground configuration', () => {
  it('starts with Soniox and a local audio turn policy', () => {
    expect(DEFAULT_LIVEKIT.stt).toBe('soniox');
    expect(DEFAULT_LIVEKIT.tts).toBe('soniox');
    expect(DEFAULT_LIVEKIT.turnDetection).toBe('audio');
    expect(LIVEKIT_TTS_MODELS.soniox).toContain(DEFAULT_LIVEKIT.ttsModel);
    expect(DEFAULT_LIVEKIT.maxEndpointDelay).toBeGreaterThan(DEFAULT_LIVEKIT.minEndpointDelay);
  });

  it('resolves only the selected part without mutating the base', () => {
    const cfg = { ...DEFAULT_LIVEKIT, parts: { '3': { llm: 'openai/gpt-6-luna' as const, maxTokens: 150 } } };
    expect(livekitPartConfig(cfg, '1').llm).toBe(DEFAULT_LIVEKIT.llm);
    expect(livekitPartConfig(cfg, '3').llm).toBe('openai/gpt-6-luna');
    expect(livekitPartConfig(cfg, '3').maxTokens).toBe(150);
    expect(livekitPartConfig(cfg, '3').tts).toBe('soniox');
    expect(livekitPartConfig(cfg, '3')).not.toHaveProperty('parts');
    expect(cfg.llm).toBe(DEFAULT_LIVEKIT.llm);
  });
});
