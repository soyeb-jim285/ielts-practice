import { ChevronDown, Eye, EyeOff } from 'lucide-react';
import { useId, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';
import { Input as ShInput, inputStyles } from './shadcn/input';
import { Label } from './shadcn/label';
import { Textarea as ShTextarea } from './shadcn/textarea';

/** Class string for a bare text-like control with a custom layout (same look as Input / Textarea / Select). */
export const controlStyles = inputStyles;

type FieldProps = { label: ReactNode; hint?: ReactNode; error?: ReactNode; /** Visually hide the label (still announced). */ hideLabel?: boolean };

function Field({ id, label, hint, error, hideLabel, children }: FieldProps & { id: string; children: ReactNode }) {
  return (
    <div>
      <Label htmlFor={id} className={cn('mb-1.5 block text-sm leading-normal font-medium text-ink', hideLabel && 'sr-only')}>
        {label}
      </Label>
      {children}
      {error ? (
        <p id={`${id}-e`} className="mt-1.5 text-sm text-bad-text">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-h`} className="mt-1.5 text-xs text-muted">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

const describedBy = (id: string, p: FieldProps) => (p.error ? `${id}-e` : p.hint ? `${id}-h` : undefined);

/** Labelled text input. type="password" gets a show/hide toggle. */
export function Input({ label, hint, error, hideLabel, className, type = 'text', ...rest }: FieldProps & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  const [show, setShow] = useState(false);
  const isPw = type === 'password';
  return (
    <Field {...{ id, label, hint, error, hideLabel }}>
      <div className="relative">
        <ShInput id={id} type={isPw && show ? 'text' : type} aria-invalid={!!error || undefined} aria-describedby={describedBy(id, { label, hint, error })} className={cn(isPw && 'pr-11', className)} {...rest} />
        {isPw && (
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            aria-label={show ? 'Hide password' : 'Show password'}
            aria-pressed={show}
            className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-lg text-muted outline-none hover:text-ink focus-visible:ring-[3px] focus-visible:ring-ring/40"
          >
            {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        )}
      </div>
    </Field>
  );
}

export function Textarea({ label, hint, error, hideLabel, className, ...rest }: FieldProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  return (
    <Field {...{ id, label, hint, error, hideLabel }}>
      <ShTextarea id={id} aria-invalid={!!error || undefined} aria-describedby={describedBy(id, { label, hint, error })} className={className} {...rest} />
    </Field>
  );
}

/**
 * Native select: the OS picker is the best UX on phones and keeps the `<option>` children API.
 * (shadcn's Radix `Select` is vendored in ./shadcn/select for custom-option cases; for long searchable lists use Combobox.)
 */
export function Select({ label, hint, error, hideLabel, className, ...rest }: FieldProps & SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId();
  return (
    <Field {...{ id, label, hint, error, hideLabel }}>
      <div className="relative">
        <select id={id} aria-invalid={!!error || undefined} aria-describedby={describedBy(id, { label, hint, error })} className={cn(inputStyles, 'h-11 appearance-none pr-9', className)} {...rest} />
        <ChevronDown aria-hidden className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted" />
      </div>
    </Field>
  );
}
