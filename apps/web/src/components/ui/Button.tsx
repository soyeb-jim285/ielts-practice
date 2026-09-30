import { clsx } from 'clsx';
import { LoaderCircle } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-ink hover:bg-accent-hover shadow-card',
  secondary: 'bg-surface text-ink border border-line hover:border-line-strong hover:bg-surface-2 shadow-card',
  ghost: 'text-ink hover:bg-ink/5 dark:hover:bg-ink/8',
  danger: 'bg-bad text-white hover:brightness-95 shadow-card',
};
const SIZES: Record<ButtonSize, string> = {
  sm: 'hit h-8 px-3 text-sm gap-1.5 [&_svg]:size-4', // 44 px touch target on phones via `hit`
  md: 'h-10 px-4 text-sm gap-2 [&_svg]:size-4',
  lg: 'h-12 px-5 text-base gap-2 [&_svg]:size-5',
  icon: 'size-10 [&_svg]:size-5',
};

/** Class string for anything that should look like a button (e.g. a router <Link>). */
export const buttonStyles = ({ variant = 'primary', size = 'md', className }: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}) =>
  clsx(
    'inline-flex shrink-0 select-none items-center justify-center rounded-control font-medium whitespace-nowrap',
    'transition-[background-color,border-color,color,box-shadow,filter,transform] duration-150 active:scale-[0.98]',
    'disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50',
    VARIANTS[variant],
    SIZES[size],
    className,
  );

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** Leading icon element, e.g. <Mic />. */
  icon?: ReactNode;
};

export function Button({ variant, size, loading, icon, className, children, disabled, type = 'button', ...rest }: Props) {
  return (
    <button type={type} className={buttonStyles({ variant, size, className })} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <LoaderCircle className="animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}
