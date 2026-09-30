import { LoaderCircle } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Button as ShButton, buttonVariants } from './shadcn/button';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm';

// Our names → shadcn's (primary=default, secondary=outline, danger=destructive).
const VARIANT = { primary: 'default', secondary: 'outline', ghost: 'ghost', danger: 'destructive', link: 'link' } as const;
const SIZE = { sm: 'sm', md: 'default', lg: 'lg', icon: 'icon', 'icon-sm': 'icon-sm' } as const;

type StyleOpts = { variant?: ButtonVariant; size?: ButtonSize; className?: string };

/** Class string for anything that should look like a button (e.g. a router <Link>). `link` variant defaults to inline text size. */
export const buttonStyles = ({ variant = 'primary', size, className }: StyleOpts = {}) =>
  cn(buttonVariants({ variant: VARIANT[variant], size: size ? SIZE[size] : variant === 'link' ? 'inline' : 'default' }), className);

type Props = Omit<ComponentProps<'button'>, 'children'> & StyleOpts & { children?: ReactNode; loading?: boolean; /** Leading icon element, e.g. <Mic />. */ icon?: ReactNode };

export function Button({ variant = 'primary', size, loading, icon, className, children, disabled, type = 'button', ...rest }: Props) {
  return (
    <ShButton
      type={type}
      variant={VARIANT[variant]}
      size={size ? SIZE[size] : variant === 'link' ? 'inline' : 'default'}
      className={className}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <LoaderCircle className="animate-spin" aria-hidden /> : icon}
      {children}
    </ShButton>
  );
}
