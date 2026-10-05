import { RotateCcw } from 'lucide-react';
import { RadioGroup } from 'radix-ui';
import { useCallback, useState } from 'react';
import { Button } from '@/components/ui';
import { DEFAULT_SETTINGS, lsGet, lsSet, parseSettings, SETTINGS_KEY, type LrSettings } from '@/lib/lr';
import { cn } from '@/lib/utils';

/** Display settings, remembered per device (not per attempt). */
export function useLrSettings() {
  const [settings, set] = useState<LrSettings>(() => parseSettings(lsGet(SETTINGS_KEY, null)));
  const update = useCallback((patch: Partial<LrSettings>) => {
    set((s) => {
      const next = { ...s, ...patch };
      lsSet(SETTINGS_KEY, next);
      return next;
    });
  }, []);
  return [settings, update] as const;
}

const SIZES: { value: LrSettings['size']; label: string; pct: string }[] = [
  { value: 'std', label: 'Standard', pct: '100%' },
  { value: 'lg', label: 'Large', pct: '125%' },
  { value: 'xl', label: 'Extra large', pct: '150%' },
];
// Swatch colours mirror the scheme table in docs/exam-fidelity.md (and styles.css).
const SCHEMES: { value: LrSettings['scheme']; label: string; bg?: string; fg?: string }[] = [
  { value: 'std', label: 'Standard' },
  { value: 'bw', label: 'Black on white', bg: '#ffffff', fg: '#000000' },
  { value: 'cream', label: 'Black on cream', bg: '#f5efdc', fg: '#000000' },
  { value: 'yb', label: 'Yellow on black', bg: '#000000', fg: '#ffe600' },
];

const optionCls = 'relative flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-line bg-card px-3 py-2 text-body transition-colors duration-[120ms] hover:border-input has-[[data-state=checked]]:border-brand has-[[data-state=checked]]:bg-accent-soft has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring';

/** Text size and colour scheme: two radio groups, applied immediately. */
export function SettingsPanel({ settings, onChange }: { settings: LrSettings; onChange: (p: Partial<LrSettings>) => void }) {
  const isDefault = settings.size === DEFAULT_SETTINGS.size && settings.scheme === DEFAULT_SETTINGS.scheme;
  return (
    <div className="space-y-5">
      <fieldset>
        <legend className="type-subheading mb-2">Text size</legend>
        <RadioGroup.Root value={settings.size} onValueChange={(v) => onChange({ size: v as LrSettings['size'] })} aria-label="Text size" className="grid gap-1.5">
          {SIZES.map((o) => (
            <label key={o.value} className={optionCls}>
              <RadioGroup.Item value={o.value} className="sr-only" />
              <Dot on={settings.size === o.value} />
              <span className="flex-1 font-medium">{o.label}</span>
              <span className="type-num type-caption">{o.pct}</span>
            </label>
          ))}
        </RadioGroup.Root>
      </fieldset>
      <fieldset>
        <legend className="type-subheading mb-2">Colours</legend>
        <RadioGroup.Root value={settings.scheme} onValueChange={(v) => onChange({ scheme: v as LrSettings['scheme'] })} aria-label="Colour scheme" className="grid gap-1.5">
          {SCHEMES.map((o) => (
            <label key={o.value} className={optionCls}>
              <RadioGroup.Item value={o.value} className="sr-only" />
              <Dot on={settings.scheme === o.value} />
              <span className="flex-1 font-medium">{o.label}</span>
              <span aria-hidden className="grid h-8 w-11 place-items-center rounded-md border border-line-strong text-sm font-semibold" style={o.bg ? { background: o.bg, color: o.fg } : { background: 'var(--surface-2)', color: 'var(--ink)' }}>
                Aa
              </span>
            </label>
          ))}
        </RadioGroup.Root>
      </fieldset>
      <div className="flex items-center justify-between gap-3">
        <p className="type-caption">Applies to the test text only, never the timer.</p>
        <Button size="sm" variant="outline" icon={<RotateCcw />} disabled={isDefault} onClick={() => onChange(DEFAULT_SETTINGS)}>
          Reset to default
        </Button>
      </div>
    </div>
  );
}

function Dot({ on }: { on: boolean }) {
  return (
    <span aria-hidden className={cn('grid size-4 shrink-0 place-items-center rounded-full border-2', on ? 'border-brand' : 'border-line-strong')}>
      {on && <span className="size-2 rounded-full bg-brand" />}
    </span>
  );
}
