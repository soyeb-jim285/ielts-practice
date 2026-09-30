import { Check, ChevronsUpDown } from 'lucide-react';
import { useId, useMemo, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from './shadcn/command';
import { inputStyles } from './shadcn/input';
import { Label } from './shadcn/label';
import { Popover, PopoverContent, PopoverTrigger } from './shadcn/popover';

/** `group`: options sharing a group render under one heading; keep each group's options adjacent. */
export type ComboOption = { value: string; label: string; description?: string; group?: string };

/** Searchable single-select (e.g. model picker with hundreds of options): shadcn combobox recipe (Popover + cmdk Command). */
export function Combobox({
  label,
  options,
  value,
  onChange,
  placeholder = 'Search…',
  emptyText = 'No matches',
  hint,
}: {
  label: ReactNode;
  options: ComboOption[];
  value: string | null;
  onChange: (value: string) => void;
  placeholder?: string;
  emptyText?: string;
  hint?: ReactNode;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = options.find((o) => o.value === value);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    // ponytail: substring match, first 100 rendered; add virtualization if lists grow past ~1k
    return (q ? options.filter((o) => `${o.label} ${o.value}`.toLowerCase().includes(q)) : options).slice(0, 100);
  }, [options, query]);

  return (
    <div>
      <Label htmlFor={id} className="mb-1.5 block text-sm leading-normal font-medium text-ink">
        {label}
      </Label>
      <Popover
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          setQuery('');
        }}
      >
        <PopoverTrigger asChild>
          <button id={id} type="button" role="combobox" aria-expanded={open} aria-haspopup="listbox" className={cn(inputStyles, 'flex h-11 items-center justify-between gap-2 text-left')}>
            <span className={cn('truncate', !selected && 'text-muted')}>{selected?.label ?? placeholder}</span>
            <ChevronsUpDown className="size-4 shrink-0 text-muted" aria-hidden />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-(--radix-popover-trigger-width) p-0">
          <Command shouldFilter={false} value={value ?? undefined}>
            <CommandInput placeholder={placeholder} value={query} onValueChange={setQuery} />
            <CommandList className="max-h-72">
              <CommandEmpty className="py-3 text-left text-sm text-muted">
                <span className="px-3">{emptyText}</span>
              </CommandEmpty>
              {shown.map((o, i) => {
                const heading = o.group && o.group !== shown[i - 1]?.group ? o.group : null;
                const item = (
                  <CommandItem
                    key={o.value}
                    value={o.value}
                    onSelect={() => {
                      onChange(o.value);
                      setOpen(false);
                    }}
                    className="items-start py-2"
                  >
                    <Check className={cn('mt-0.5 size-4 shrink-0 text-brand-text', o.value !== value && 'invisible')} aria-hidden />
                    <span className="min-w-0">
                      <span className="block truncate text-ink">{o.label}</span>
                      {o.description && <span className="block truncate text-xs text-muted">{o.description}</span>}
                    </span>
                  </CommandItem>
                );
                return heading ? (
                  <div key={o.value}>
                    <p role="presentation" className="px-3 pt-2.5 pb-1 text-xs font-medium text-muted">
                      {heading}
                    </p>
                    {item}
                  </div>
                ) : (
                  item
                );
              })}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {hint && <p className="mt-1.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}
