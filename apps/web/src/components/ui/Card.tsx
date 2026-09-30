import { clsx } from 'clsx';
import type { HTMLAttributes } from 'react';

type Props = HTMLAttributes<HTMLDivElement> & { padded?: boolean; interactive?: boolean };

/** Surface container. Never nest Cards; use `bg-surface-2` insets or dividers inside one instead. */
export function Card({ padded = true, interactive, className, ...rest }: Props) {
  return (
    <div
      className={clsx(
        'rounded-card border border-line bg-surface shadow-card',
        padded && 'p-5',
        interactive && 'transition-[border-color,box-shadow] duration-150 hover:border-line-strong hover:shadow-pop',
        className,
      )}
      {...rest}
    />
  );
}
