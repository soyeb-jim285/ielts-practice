import { useState } from 'react';
import { useUpdateSettings } from '@/components/settings/useUpdateSettings';
import { Input, Select } from '@/components/ui';
import { useMe } from '@/lib/query';

const BANDS = Array.from({ length: 11 }, (_, i) => 4 + i * 0.5); // same range as the settings slider and API
const today = () => new Date().toLocaleDateString('en-CA'); // local YYYY-MM-DD

/** Whole days from today to `date` (YYYY-MM-DD), or null when unset or past. */
export const daysUntil = (date: string | null | undefined) => {
  if (!date) return null;
  const d = Math.round((Date.parse(date) - Date.parse(today())) / 86_400_000);
  return d < 0 ? null : d;
};

/** Exam date field, shared by the coach header and Settings. Clearing it removes the date. */
export function ExamDateInput({ className }: { className?: string }) {
  const value = useMe().data?.settings.examDate ?? '';
  const { mutate } = useUpdateSettings();
  return (
    <Input
      type="date"
      label="Exam date"
      min={value ? undefined : today()} // a saved past date must not show as invalid
      value={value}
      className={className}
      onChange={(e) => {
        const v = e.target.value;
        if (v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v)) mutate({ examDate: v || null });
      }}
    />
  );
}

/** Coach header controls: target band and exam date. `chosen` is the target the report used (null when the student never picked one). */
export function GoalControls({ chosen }: { chosen: number | null }) {
  const [target, setTarget] = useState(chosen);
  const { mutate } = useUpdateSettings();
  return (
    <div className="flex flex-wrap items-end gap-3 max-sm:grid max-sm:w-full max-sm:grid-cols-2">
      <Select
        label="Target band"
        value={target ?? ''}
        className="sm:w-32"
        onChange={(e) => {
          const v = Number(e.target.value);
          setTarget(v);
          mutate({ targetBand: v });
        }}
      >
        {target == null && (
          <option value="" disabled>
            Choose
          </option>
        )}
        {BANDS.map((b) => (
          <option key={b} value={b}>
            {b.toFixed(1)}
          </option>
        ))}
      </Select>
      <ExamDateInput className="sm:w-44" />
    </div>
  );
}
