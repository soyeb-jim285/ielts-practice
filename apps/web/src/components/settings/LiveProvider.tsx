import { Link } from '@tanstack/react-router';
import { RadioGroup } from 'radix-ui';
import { rowStyles } from '@/components/bank/ListRow';
import { buttonStyles } from '@/components/ui';
import type { Settings } from '@/lib/api';
import { cn } from '@/lib/utils';

export type Provider = Settings['liveProvider'];

/** The names Settings and the pre-test screen both use. */
export const PROVIDER_LABEL: Record<Provider, string> = {
  turn: 'Examiner waits for you to finish',
  'gpt-live': 'Natural conversation (GPT-Live)',
  'gemini-live': 'Natural conversation (Gemini)',
};

/** Conversation mode: exclusive choice as two full-width rows (Radix RadioGroup), so the options share the settings row rhythm instead of nesting tiles in a card. */
export function LiveProvider({ value, available, onChange }: { value: Provider; available: Partial<Record<Provider, boolean>>; onChange: (v: Provider) => void }) {
  const natural = 'Talk back and forth as in the real test. You can interrupt each other.';
  const options = [
    { value: 'turn' as const, description: available.turn === false ? 'Needs your own OpenRouter key.' : 'The examiner asks a question, then listens until you pause.', disabled: available.turn === false },
    { value: 'gpt-live' as const, description: available['gpt-live'] ? natural : 'Needs your own OpenAI key.', disabled: !available['gpt-live'] },
    { value: 'gemini-live' as const, description: available['gemini-live'] ? natural : 'Needs your own Gemini key.', disabled: !available['gemini-live'] },
  ];
  const locked = options.some((o) => o.disabled);
  return (
    <>
    <RadioGroup.Root value={value} onValueChange={(v) => onChange(v as Provider)} aria-label="Conversation mode" className="-my-4 divide-y divide-line">
      {options.map((o) => (
        <RadioGroup.Item
          key={o.value}
          value={o.value}
          disabled={o.disabled}
          className={cn(
            rowStyles,
            // The selected wash stays inside the column (inset-x-0), so it never pokes past the edge the other settings rows align to.
            'gap-4 px-3 py-4 before:inset-x-0 aria-checked:before:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:before:bg-transparent',
          )}
        >
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">{PROVIDER_LABEL[o.value]}</span>
            <span className="type-caption mt-0.5 block max-w-[60ch]">{o.description}</span>
          </span>
          <span className="grid size-5 shrink-0 place-items-center rounded-full border-2 border-input transition-colors group-aria-checked:border-brand group-aria-checked:bg-brand">
            <RadioGroup.Indicator className="size-1.5 rounded-full bg-brand-ink" />
          </span>
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
    {locked && (
      <p className="type-caption pt-5">
        The live examiner never uses the community balance.{' '}
        <Link to="/settings" hash="api-keys" className={buttonStyles({ variant: 'link', className: 'hit' })}>
          Add your own key
        </Link>
      </p>
    )}
    </>
  );
}
