import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// text-body / text-caption / text-micro are our named font sizes (styles.css @theme); without this twMerge reads them as colours
// and silently drops a real colour class such as text-primary-foreground.
const twMerge = extendTailwindMerge({ extend: { classGroups: { 'font-size': [{ text: ['body', 'caption', 'micro'] }] } } });

/** Class-name helper used by every shadcn primitive: conditional classes + conflict-free Tailwind merge. */
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
