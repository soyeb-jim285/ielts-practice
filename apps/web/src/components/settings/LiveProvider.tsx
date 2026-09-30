import { RadioGroup } from 'radix-ui';
import { rowStyles } from '@/components/bank/ListRow';
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
    <RadioGroup.Root value={value} onValueChange={(v) => onChange(v as Provider)} aria-label="Conversation mode" className="-my-4 divide-y divide-line">
      {options.map((o) => (
        <RadioGroup.Item
          key={o.value}
          value={o.value}
          disabled={o.disabled}
          className={cn(rowStyles, 'gap-4 py-4 aria-checked:before:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:before:bg-transparent')}
        >
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">{o.label}</span>
            <span className="type-caption mt-0.5 block max-w-[60ch]">{o.description}</span>
          </span>
          <span className="grid size-5 shrink-0 place-items-center rounded-full border-2 border-input transition-colors group-aria-checked:border-brand group-aria-checked:bg-brand">
            <RadioGroup.Indicator className="size-1.5 rounded-full bg-brand-ink" />
          </span>
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}
