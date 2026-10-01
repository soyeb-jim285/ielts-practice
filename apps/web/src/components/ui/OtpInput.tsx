import { REGEXP_ONLY_DIGITS } from 'input-otp';
import { useId } from 'react';
import { InputOTP, InputOTPGroup, InputOTPSlot } from './shadcn/input-otp';

/** Digits only: what a one-time code field accepts from typing, paste or autofill. */
export const digitsOnly = (s: string, max = 6) => s.replace(/\D/g, '').slice(0, max);

/**
 * Six-box one-time code field: shadcn InputOTP (one real input behind the boxes), so typing, Backspace, paste and the
 * OS `one-time-code` autofill all work natively. Digits only.
 */
export function OtpInput({ label = 'Verification code', value, onChange, length = 6, error, autoFocus }: { label?: string; value: string; onChange: (v: string) => void; length?: number; error?: string | false | null; autoFocus?: boolean }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm leading-normal font-medium text-ink">
        {label}
      </label>
      <InputOTP
        id={id}
        maxLength={length}
        value={value}
        onChange={(v) => onChange(digitsOnly(v, length))}
        pattern={REGEXP_ONLY_DIGITS}
        pasteTransformer={(t) => digitsOnly(t, length)}
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus={autoFocus}
        aria-invalid={!!error || undefined}
        aria-describedby={error ? `${id}-e` : undefined}
      >
        <InputOTPGroup>
          {Array.from({ length }, (_, i) => (
            <InputOTPSlot key={i} index={i} aria-invalid={!!error || undefined} />
          ))}
        </InputOTPGroup>
      </InputOTP>
      {error && (
        <p id={`${id}-e`} className="mt-1.5 text-sm text-bad-text">
          {error}
        </p>
      )}
    </div>
  );
}
