import { useId, useRef, type ClipboardEvent, type KeyboardEvent } from 'react';
import { cn } from '@/lib/utils';
import { controlStyles } from './Field';

/** Digits only: what a one-time code field accepts from typing, paste or autofill. */
export const digitsOnly = (s: string, max = 6) => s.replace(/\D/g, '').slice(0, max);

/**
 * N one-digit boxes behind one string value. Typing advances, Backspace steps back, a paste (or the OS autofill, which lands in the first box)
 * spreads across the boxes. Only the first box asks for `one-time-code`, so the browser offers the code from an SMS/email once, not per box.
 */
export function OtpInput({ label = 'Verification code', value, onChange, length = 6, error, autoFocus }: { label?: string; value: string; onChange: (v: string) => void; length?: number; error?: string | false | null; autoFocus?: boolean }) {
  const id = useId();
  const boxes = useRef<(HTMLInputElement | null)[]>([]);
  const focus = (i: number) => boxes.current[Math.max(0, Math.min(i, length - 1))]?.focus();

  /** Put `digits` at box i (never leaving a gap) and move to the box after them. */
  function put(i: number, raw: string) {
    const digits = digitsOnly(raw, length);
    if (!digits) return;
    const at = Math.min(i, value.length);
    onChange(digitsOnly(value.slice(0, at) + digits + value.slice(at + digits.length), length));
    focus(at + digits.length);
  }
  function onKey(i: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !value[i] && i > 0) {
      e.preventDefault();
      onChange(value.slice(0, i - 1) + value.slice(i));
      focus(i - 1);
    } else if (e.key === 'ArrowLeft') focus(i - 1);
    else if (e.key === 'ArrowRight') focus(i + 1);
  }
  const onPaste = (i: number) => (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    put(i, e.clipboardData.getData('text'));
  };

  return (
    <div role="group" aria-labelledby={`${id}-l`} aria-describedby={error ? `${id}-e` : undefined}>
      <p id={`${id}-l`} className="mb-1.5 text-sm leading-normal font-medium text-ink">
        {label}
      </p>
      <div className="flex gap-2">
        {Array.from({ length }, (_, i) => (
          <input
            key={i}
            ref={(el) => {
              boxes.current[i] = el;
            }}
            value={value[i] ?? ''}
            onChange={(e) => (e.target.value ? put(i, e.target.value) : onChange(value.slice(0, i) + value.slice(i + 1)))}
            onKeyDown={(e) => onKey(i, e)}
            onPaste={onPaste(i)}
            onFocus={(e) => e.target.select()}
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete={i === 0 ? 'one-time-code' : 'off'}
            autoFocus={autoFocus && i === 0}
            aria-label={`Digit ${i + 1} of ${length}`}
            aria-invalid={!!error || undefined}
            className={cn(controlStyles, 'type-num h-12 max-w-12 min-w-0 flex-1 px-0 text-center text-xl font-medium')}
          />
        ))}
      </div>
      {error && (
        <p id={`${id}-e`} className="mt-1.5 text-sm text-bad-text">
          {error}
        </p>
      )}
    </div>
  );
}
