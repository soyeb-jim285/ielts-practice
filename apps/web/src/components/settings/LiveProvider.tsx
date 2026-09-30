import { RadioGroup } from 'radix-ui';
import type { Settings } from '@/lib/api';
import { cn } from '@/lib/utils';

type Provider = Settings['liveProvider'];

/** Conversation mode: exclusive choice as two full-width rows (Radix RadioGroup), so the options share the settings row rhythm instead of nesting tiles in a card. */
export function LiveProvider({ value, available, onChange }: { value: Provider; available: boolean; onChange: (v: Provider) => void }) {
  const options = [
    { value: 'turn' as const, label: 'Examiner waits for you to finish', description: 'The examiner asks a question, then listens until you pause.' },
    {
      value: 'openai-realtime' as const,
      label: 'Natural conversation',
      description: available ? 'Talk back and forth as in the real test. You can interrupt each other.' : 'Not available right now.',
      disabled: !available,
    },
  ];
  return (
    <RadioGroup.Root value={value} onValueChange={(v) => onChange(v as Provider)} aria-label="Conversation mode" className="divide-y divide-line">
      {options.map((o) => (
        <RadioGroup.Item
          key={o.value}
          value={o.value}
          disabled={o.disabled}
          className={cn(
            'group flex w-full items-center gap-4 px-5 py-4 text-left transition-colors duration-150 outline-none',
            'hover:bg-hover focus-visible:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent',
          )}
        >
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">{o.label}</span>
            <span className="mt-0.5 block max-w-[60ch] text-sm text-muted">{o.description}</span>
          </span>
          <span className="grid size-5 shrink-0 place-items-center rounded-full border-2 border-input transition-colors group-aria-checked:border-brand group-aria-checked:bg-brand">
            <RadioGroup.Indicator className="size-1.5 rounded-full bg-brand-ink" />
          </span>
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}
