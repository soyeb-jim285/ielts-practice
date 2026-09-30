import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';
import { Card as ShCard } from './shadcn/card';

type Props = ComponentProps<'div'> & {
  padded?: boolean;
  interactive?: boolean;
  /** `hero`: the one "do this next" block per screen (brand-tinted). */
  tone?: 'default' | 'hero';
};

/** Surface container: hairline border, 12px radius, one subtle shadow. Never nest Cards; use `bg-surface-2` insets or dividers inside one instead. */
export function Card({ padded = true, interactive, tone = 'default', className, ...rest }: Props) {
  return (
    <ShCard
      className={cn(
        padded && 'p-5',
        tone === 'hero' && 'border-brand/20 bg-accent-soft shadow-none',
        interactive && 'transition-[border-color,background-color] duration-[120ms] ease-(--ease-out-expo) hover:border-input',
        className,
      )}
      {...rest}
    />
  );
}
export { CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './shadcn/card';
