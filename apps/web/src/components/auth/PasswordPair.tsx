import { Check } from 'lucide-react';
import { useState } from 'react';
import { Input } from '@/components/ui';

/** New password + confirmation. `submitted` (the parent's form was submitted with a mismatch) shows the error at once; otherwise it appears once the confirm field is left. */
export function PasswordPair({ label = 'Password', confirmLabel = 'Confirm password', submitted }: { label?: string; confirmLabel?: string; submitted: boolean }) {
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [left, setLeft] = useState(false);
  const mismatch = (left || submitted) && confirm !== pw;
  return (
    <>
      <Input
        label={label}
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={8}
        maxLength={128}
        required
        value={pw}
        onChange={(e) => setPw(e.target.value)}
        hint={
          pw.length >= 8 ? (
            <span className="inline-flex items-center gap-1 text-good-text">
              <Check className="size-4" aria-hidden /> 8 characters or more
            </span>
          ) : (
            'At least 8 characters.'
          )
        }
      />
      <Input
        label={confirmLabel}
        name="confirm"
        type="password"
        autoComplete="new-password"
        minLength={8}
        maxLength={128}
        required
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        onBlur={() => confirm && setLeft(true)}
        error={mismatch && 'The two passwords don’t match.'}
      />
    </>
  );
}

/** True when the form's password and confirm fields agree. */
export const passwordsMatch = (f: FormData) => f.get('password') === f.get('confirm');
