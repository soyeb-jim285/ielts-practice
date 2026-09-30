import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { Combobox, type ComboOption } from '@/components/ui';
import { api } from '@/lib/api';

export type Capability = 'text' | 'audio-in' | 'stt' | 'tts';
type Model = { id: string; name: string; input: string[]; output: string[]; pricing: { prompt: string; completion: string } };

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
  const { data, isPending, isError } = useQuery({
    queryKey: ['models', capability],
    queryFn: () => api.get<{ models: Model[] }>(`/models?capability=${capability}`),
    staleTime: 60 * 60_000,
  });
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
