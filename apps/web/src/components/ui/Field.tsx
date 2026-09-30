import { clsx } from 'clsx';
import { Eye, EyeOff } from 'lucide-react';
import { useId, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

export const controlStyles = clsx(
  'w-full rounded-control border border-line bg-surface px-3 text-[0.9375rem] text-ink shadow-card transition-[border-color,box-shadow] duration-150',
  'placeholder:text-muted hover:border-line-strong focus:border-accent focus:ring-3 focus:ring-accent/20 focus:outline-none',
  'disabled:bg-surface-2 disabled:opacity-60 aria-invalid:border-bad aria-invalid:focus:ring-bad/20',
);

type FieldProps = { label: ReactNode; hint?: ReactNode; error?: ReactNode; /** Visually hide the label (still announced). */ hideLabel?: boolean };

function Field({ id, label, hint, error, hideLabel, children }: FieldProps & { id: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className={clsx('mb-1.5 block text-sm font-medium text-ink', hideLabel && 'sr-only')}>
        {label}
      </label>
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
        <input
          id={id}
          type={isPw && show ? 'text' : type}
          aria-invalid={!!error || undefined}
          aria-describedby={describedBy(id, { label, hint, error })}
          className={clsx(controlStyles, 'h-11', isPw && 'pr-11', className)}
          {...rest}
        />
        {isPw && (
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            aria-label={show ? 'Hide password' : 'Show password'}
            aria-pressed={show}
            className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-control text-muted hover:text-ink"
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
      <textarea
        id={id}
        aria-invalid={!!error || undefined}
        aria-describedby={describedBy(id, { label, hint, error })}
        className={clsx(controlStyles, 'min-h-24 py-2.5 leading-relaxed', className)}
        {...rest}
      />
    </Field>
  );
}

/** Native select (best on mobile). For long searchable lists use Combobox. */
export function Select({ label, hint, error, hideLabel, className, ...rest }: FieldProps & SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId();
  return (
    <Field {...{ id, label, hint, error, hideLabel }}>
      <select id={id} aria-invalid={!!error || undefined} aria-describedby={describedBy(id, { label, hint, error })} className={clsx(controlStyles, 'h-11 pr-8', className)} {...rest} />
    </Field>
  );
}
