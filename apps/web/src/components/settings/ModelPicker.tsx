import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { Button, Combobox, type ComboOption } from '@/components/ui';
import { call, client, type Schemas, type Settings } from '@/lib/api';

export type Capability = 'text' | 'audio-in' | 'stt' | 'tts';
type Model = Omit<Schemas['Model'], 'voices'> & { voices?: string[] };

// ponytail: mirrors DEFAULT_SETTINGS.models in apps/server/src/settings.ts (that module imports the db, so the web can't import it
// at runtime); ModelPicker.test.ts fails if they drift.
export const DEFAULT_MODELS: Settings['models'] = {
  analysis: 'openai/gpt-6-luna',
  examiner: 'openai/gpt-6-luna',
  stt: 'openai/whisper-large-v3',
  tts: 'google/gemini-3.8-flash-tts',
  ttsVoice: 'Charon',
  audioPron: 'google/gemini-2.5-flash',
};

/** Voice to keep when the TTS model changes: the current one if the new model supports it, else its first voice (unknown list → keep). */
export const pickVoice = (voices: string[] | undefined, current: string) => (!voices?.length || voices.includes(current) ? current : voices[0]!);

export const useModels = (capability: Capability) =>
  useQuery({
    queryKey: ['models', capability],
    queryFn: () => call(client.GET('/api/models', { params: { query: { capability } } })),
    staleTime: 60 * 60_000,
  });

/** Well-known models per capability, listed first under "Recommended" (the default always joins them; ids missing from the catalogue are skipped). */
export const RECOMMENDED: Record<Capability, string[]> = {
  text: ['openai/gpt-6-luna', 'google/gemini-3.8-flash', 'anthropic/claude-sonnet-5.5', 'deepseek/deepseek-v4-flash'],
  stt: ['elevenlabs/scribe_v2', 'openai/whisper-large-v3', 'nvidia/parakeet-tdt-0.6b-v3'],
  tts: ['google/gemini-3.8-flash-tts', 'google/gemini-3.8-flash-lite-tts'],
  'audio-in': ['google/gemini-2.5-flash', 'google/gemini-3.8-flash'],
};

// ponytail: rough token budgets for one scored essay / spoken answer (prompt + rubric + answer in, JSON feedback out); tune from real usage.
// Speech models price per second or per character, so no per-use estimate for stt/tts.
const PER_USE: Partial<Record<Capability, { in: number; out: number; unit: string }>> = {
  text: { in: 8000, out: 3000, unit: 'essay' },
  'audio-in': { in: 6000, out: 1500, unit: 'answer' },
};

/** Approximate USD cost of one use from per-token prices: "<1¢", "~3¢", "~$0.12"; undefined when OpenRouter reports variable pricing. */
export function perUseCost(pricing: Model['pricing'], use: { in: number; out: number }) {
  const [i, o] = [Number(pricing.prompt), Number(pricing.completion)];
  if (!(i >= 0 && o >= 0)) return undefined;
  const usd = i * use.in + o * use.out;
  return usd === 0 ? 'free' : usd < 0.01 ? '<1¢' : usd < 0.995 ? `~${Math.round(usd * 100)}¢` : `~$${usd.toFixed(2)}`;
}

/** What each speech-to-text model does with um/uh and timing, from our own tests (docs/stt-models.md). Unlisted models: no note. */
export const STT_NOTES: Record<string, string> = {
  'elevenlabs/scribe_v2': 'keeps um/uh and repetitions, most accurate word timing; needs the app\'s ElevenLabs key',
  'openai/whisper-large-v3': 'cheapest; we prompt it to keep um/uh; word times can run early over pauses',
  'nvidia/parakeet-tdt-0.6b-v3': 'fast and keeps um/uh, but word times are coarse and it corrects some grammar',
};

export const modelOption = (m: Model, capability: Capability, group?: string): ComboOption => {
  const use = PER_USE[capability];
  const cost = use && perUseCost(m.pricing, use);
  const note = capability === 'stt' ? STT_NOTES[m.id] : undefined;
  return { value: m.id, label: m.name, description: note ? `${m.id} · ${note}` : cost ? `${m.id} · ${cost} per ${use.unit}` : m.id, group };
};

/**
 * Recommended first (plus the saved model under "Current" when it isn't one of them, so it opens at the top), then the rest;
 * `:batch` variants dropped (async batch API, unusable for interactive scoring).
 */
export function modelOptions(models: Model[], capability: Capability, defaultValue: string, value = defaultValue): ComboOption[] {
  const rec = new Set([defaultValue, ...RECOMMENDED[capability]]);
  const usable = models.filter((m) => !m.id.endsWith(':batch'));
  const pick = (ids: string[], group: string) => ids.flatMap((id) => usable.filter((m) => m.id === id)).map((m) => modelOption(m, capability, group));
  const top = [...(rec.has(value) ? [] : pick([value], 'Current')), ...pick([...rec], 'Recommended')];
  return [...top, ...usable.filter((m) => !rec.has(m.id) && m.id !== value).map((m) => modelOption(m, capability, 'All models'))];
}

/** Searchable OpenRouter model combobox (Recommended first, approximate cost per use) with "Reset to default". */
export function ModelPicker({
  label,
  capability,
  value,
  defaultValue,
  onChange,
  hint,
}: {
  label: string;
  capability: Capability;
  value: string;
  defaultValue: string;
  onChange: (id: string) => void;
  hint?: string;
}) {
  const { data, isPending, isError } = useModels(capability);
  const options = useMemo(() => {
    const list = modelOptions(data?.models ?? [], capability, defaultValue, value);
    // Keep the saved id selectable even when it's missing from the list (loading, error, or delisted).
    return list.some((o) => o.value === value) ? list : [{ value, label: value, description: isPending ? 'Loading models…' : 'Current model' }, ...list];
  }, [data, value, isPending, capability, defaultValue]);

  // Same catalogue entry as the option list, so the reset text names the default the way the picker does.
  const defaultName = data?.models.find((m) => m.id === defaultValue)?.name ?? defaultValue;
  return (
    <Combobox
      label={label}
      options={options}
      value={value}
      onChange={onChange}
      placeholder="Search by name or id…"
      emptyText="No models match"
      hint={
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {isError ? <span className="text-bad-text">Couldn't load the model list. Your current choice still works.</span> : hint}
          {value !== defaultValue ? (
            <Button variant="link" onClick={() => onChange(defaultValue)}>
              Reset to default ({defaultName})
            </Button>
          ) : (
            <span>Default</span>
          )}
        </span>
      }
    />
  );
}

/** Examiner voice model + a Voice picker limited to the voices that model supports. */
export function TtsPicker({ value, voice, onChange }: { value: string; voice: string; onChange: (patch: { tts?: string; ttsVoice?: string }) => void }) {
  const { data } = useModels('tts');
  const voicesOf = (id: string) => data?.models.find((m) => m.id === id)?.voices;
  const voices = voicesOf(value) ?? [];
  const options = (voices.includes(voice) ? voices : [voice, ...voices]).map((v) => ({ value: v, label: v }));
  return (
    <div className="space-y-4">
      <ModelPicker label="Examiner voice model" capability="tts" value={value} defaultValue={DEFAULT_MODELS.tts} onChange={(tts) => onChange({ tts, ttsVoice: pickVoice(voicesOf(tts), voice) })} />
      <Combobox label="Voice" options={options} value={voice} onChange={(ttsVoice) => onChange({ ttsVoice })} placeholder="Search voices…" emptyText="No voices match" />
    </div>
  );
}
