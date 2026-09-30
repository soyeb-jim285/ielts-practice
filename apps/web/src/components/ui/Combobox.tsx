import { clsx } from 'clsx';
import { Check, ChevronsUpDown } from 'lucide-react';
import { useId, useMemo, useState, type ReactNode } from 'react';
import { controlStyles } from './Field';

/** `group`: options sharing a group render under one heading; keep each group's options adjacent. */
export type ComboOption = { value: string; label: string; description?: string; group?: string };

/** Searchable single-select (e.g. model picker with hundreds of options). ARIA 1.2 combobox pattern. */
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
  const [active, setActive] = useState(0);
  const selected = options.find((o) => o.value === value);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    // ponytail: substring match, first 100 rendered; add virtualization if lists grow past ~1k
    return (q ? options.filter((o) => `${o.label} ${o.value}`.toLowerCase().includes(q)) : options).slice(0, 100);
  }, [options, query]);

  const pick = (o: ComboOption) => {
    onChange(o.value);
    setOpen(false);
    setQuery('');
  };
  const openList = () => {
    setOpen(true);
    setActive(Math.max(0, shown.findIndex((o) => o.value === value)));
  };

  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-ink">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={open && shown[active] ? `${id}-${active}` : undefined}
          autoComplete="off"
          spellCheck={false}
          className={clsx(controlStyles, 'h-11 pr-10')}
          placeholder={selected ? selected.label : placeholder}
          value={open ? query : (selected?.label ?? '')}
          onFocus={openList}
          onClick={openList}
          onBlur={() => setOpen(false)}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              if (!open) return openList();
              setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % Math.max(1, shown.length));
            } else if (e.key === 'Enter' && open && shown[active]) {
              e.preventDefault();
              pick(shown[active]);
            } else if (e.key === 'Escape') {
              setOpen(false);
              setQuery('');
            }
          }}
        />
        <ChevronsUpDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
        {open && (
          <ul
            id={`${id}-list`}
            role="listbox"
            className="absolute inset-x-0 top-full z-[60] mt-1.5 max-h-72 overflow-y-auto rounded-card border border-line bg-surface p-1 shadow-pop"
          >
            {shown.length === 0 && <li className="px-3 py-2.5 text-sm text-muted">{emptyText}</li>}
            {shown.map((o, i) => [
              o.group && o.group !== shown[i - 1]?.group && (
                <li key={`g-${o.group}`} role="presentation" className="px-3 pt-2.5 pb-1 text-xs font-medium text-muted">
                  {o.group}
                </li>
              ),
              <li
                key={o.value}
                id={`${id}-${i}`}
                role="option"
                aria-selected={o.value === value}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(o)}
                ref={i === active ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined}
                className={clsx('flex cursor-pointer items-start gap-2 rounded-lg px-3 py-2 text-sm', i === active && 'bg-ink/5 dark:bg-ink/8')}
              >
                <Check className={clsx('mt-0.5 size-4 shrink-0 text-accent-text', o.value !== value && 'invisible')} aria-hidden />
                <span className="min-w-0">
                  <span className="block truncate text-ink">{o.label}</span>
                  {o.description && <span className="block truncate text-xs text-muted">{o.description}</span>}
                </span>
              </li>,
            ])}
          </ul>
        )}
      </div>
      {hint && <p className="mt-1.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}
