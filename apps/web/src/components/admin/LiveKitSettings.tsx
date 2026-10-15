import { useState } from 'react';
import { LIVEKIT_TTS_MODELS, type LiveKitConfig, type LiveKitPartConfig } from '@ielts/core';
import { Input, Select, Switch } from '@/components/ui';

export function LiveKitSettings({ cfg, set, disabled }: { cfg: LiveKitConfig; set: (cfg: LiveKitConfig) => void; disabled: boolean }) {
  const [scope, setScope] = useState<'base' | '1' | '2' | '3'>('base');
  const { parts, ...base } = cfg;
  const effective = scope === 'base' ? base : { ...base, ...parts?.[scope] };
  const edit = (patch: Partial<LiveKitPartConfig>) => {
    if (patch.minEndpointDelay !== undefined && patch.minEndpointDelay > effective.maxEndpointDelay) patch.maxEndpointDelay = patch.minEndpointDelay;
    set(scope === 'base' ? { ...cfg, ...patch } : { ...cfg, parts: { ...parts, [scope]: { ...effective, ...patch } } });
  };
  const num = (key: 'minEndpointDelay' | 'maxEndpointDelay' | 'vadSilence' | 'temperature' | 'maxTokens', label: string, min: number, max: number, step: number) => <Input label={label} type="number" min={min} max={max} step={step} value={effective[key]} disabled={disabled} onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) edit({ [key]: Math.min(max, Math.max(min, n)) }); }} />;
  return <div className="mt-4 space-y-4">
    <p className="type-caption">Settings apply next session. Stored part overrides switch automatically at IELTS part boundaries. Audio turn detection runs local v1-mini on the worker, not in this browser.</p>
    <Select label="Configuration profile" value={scope} disabled={disabled} onChange={(e) => setScope(e.target.value as typeof scope)}>
      <option value="base">Base</option>{(['1', '2', '3'] as const).map((part) => <option key={part} value={part}>Part {part}{parts?.[part] ? ' (override)' : ' (use base)'}</option>)}
    </Select>
    {scope !== 'base' && <Switch label="Use base configuration" checked={!parts?.[scope]} disabled={disabled} onChange={(useBase) => { const next = { ...parts }; if (useBase) delete next[scope]; else next[scope] = { ...effective }; set({ ...cfg, parts: next }); }} description="Editing any field creates a complete copy of this part's effective configuration." />}
    <div className="grid gap-6 md:grid-cols-3">
      <fieldset className="space-y-3"><legend className="type-caption font-medium">Hearing and turn detection</legend>
        <Select label="Transcription provider / model" value={effective.stt} disabled={disabled} onChange={(e) => edit(e.target.value === 'soniox' ? { stt: 'soniox', sttModel: 'stt-rt-v5' } : { stt: 'elevenlabs', sttModel: 'scribe_v2_realtime' })}>
          <option value="soniox">Soniox / stt-rt-v5</option><option value="elevenlabs">ElevenLabs / scribe_v2_realtime</option>
        </Select>
        <Select label="Turn detection" value={effective.turnDetection} disabled={disabled} onChange={(e) => edit({ turnDetection: e.target.value as 'audio' | 'vad' })}><option value="audio">Audio / local v1-mini (worker)</option><option value="vad">VAD only</option></Select>
        {num('minEndpointDelay', 'Minimum endpoint delay (s)', 0, 10, 0.1)}
        {num('maxEndpointDelay', 'Maximum endpoint delay (s)', Math.max(0.1, effective.minEndpointDelay), 10, 0.1)}
        {num('vadSilence', 'VAD silence (s)', 0.1, 2, 0.05)}
      </fieldset>
      <fieldset className="space-y-3"><legend className="type-caption font-medium">Reply</legend>
        <Select label="LLM (OpenRouter)" value={effective.llm} disabled={disabled} onChange={(e) => edit({ llm: e.target.value as LiveKitPartConfig['llm'] })}><option value="deepseek/deepseek-v4.1-flash">DeepSeek V4.1 Flash</option><option value="openai/gpt-6-luna">GPT-6 Luna</option></Select>
        {num('temperature', 'Temperature', 0, 2, 0.1)}{num('maxTokens', 'Maximum reply tokens', 16, 2048, 1)}
        <Switch label="Interruptions" checked={effective.interruptions} disabled={disabled} onChange={(v) => edit({ interruptions: v })} />
        <Switch label="Preemptive generation" checked={effective.preemptiveGeneration} disabled={disabled} onChange={(v) => edit({ preemptiveGeneration: v })} />
      </fieldset>
      <fieldset className="space-y-3"><legend className="type-caption font-medium">Voice</legend>
        <Select label="TTS provider" value={effective.tts} disabled={disabled} onChange={(e) => { const tts = e.target.value as LiveKitPartConfig['tts']; edit({ tts, ttsModel: LIVEKIT_TTS_MODELS[tts][0], voice: tts === 'soniox' ? 'Adrian' : 'default' }); }}>{Object.keys(LIVEKIT_TTS_MODELS).map((p) => <option key={p} value={p}>{p}</option>)}</Select>
        <Select label="TTS model" value={effective.ttsModel} disabled={disabled} onChange={(e) => edit({ ttsModel: e.target.value })}>{LIVEKIT_TTS_MODELS[effective.tts].map((m) => <option key={m} value={m}>{m}</option>)}</Select>
        <Input label="Voice name or id" hint="Provider voice name/id; use default for the worker's default." value={effective.voice} disabled={disabled} onChange={(e) => edit({ voice: e.target.value })} />
      </fieldset>
    </div>
  </div>;
}
