import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Class-name helper used by every shadcn primitive: conditional classes + conflict-free Tailwind merge. */
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
