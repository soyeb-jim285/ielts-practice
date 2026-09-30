import { useId, type ReactNode } from 'react';
import { Label } from './shadcn/label';
import { Switch as ShSwitch } from './shadcn/switch';

/** On/off setting row. `label` is required (accessible name); `description` shows under it. */
export function Switch({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; description?: ReactNode; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <Label htmlFor={id} className="text-sm leading-normal font-medium text-ink">
          {label}
        </Label>
        {description && (
          <p id={`${id}-d`} className="mt-0.5 text-sm text-muted">
            {description}
          </p>
        )}
      </div>
      <ShSwitch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} aria-describedby={description ? `${id}-d` : undefined} className="mt-0.5" />
    </div>
  );
}
