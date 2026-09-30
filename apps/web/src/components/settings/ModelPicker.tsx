import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { Combobox, type ComboOption } from '@/components/ui';
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

const useModels = (capability: Capability) =>
  useQuery({
    queryKey: ['models', capability],
    queryFn: () => call(client.GET('/api/models', { params: { query: { capability } } })),
    staleTime: 60 * 60_000,
  });

/** USD-per-token string → "$0.25" per 1M tokens. OpenRouter uses "-1" for variable pricing. */
export function perMillion(perToken: string) {
  const n = Number(perToken) * 1e6;
  if (!Number.isFinite(n) || n < 0) return 'variable';
  if (n === 0) return 'free';
  return `$${n < 10 ? n.toFixed(2) : n.toFixed(0)}`;
}

export const modelOption = (m: Model): ComboOption => {
  const [i, o] = [perMillion(m.pricing.prompt), perMillion(m.pricing.completion)];
  const price = i === 'free' && o === 'free' ? 'Free' : `${i} in · ${o} out per 1M`;
  return { value: m.id, label: m.name, description: `${m.id} · ${price}` };
};

/** Searchable OpenRouter model combobox (id, name, price per 1M tokens) with "Reset to default". */
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
    const list = (data?.models ?? []).map(modelOption);
    // Keep the saved id selectable even when it's missing from the list (loading, error, or delisted).
    return list.some((o) => o.value === value) ? list : [{ value, label: value, description: isPending ? 'Loading models…' : 'Current model' }, ...list];
  }, [data, value, isPending]);

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
            <button type="button" onClick={() => onChange(defaultValue)} className="font-medium text-accent-text underline-offset-2 hover:underline">
              Reset to default ({defaultValue})
            </button>
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
