import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** The two content widths of the app. Anything that needs a column (PageContainer, ExamShell) takes it from here. */
export const WIDTH = { page: 'max-w-[1080px]', reading: 'max-w-[720px]' } as const;

/**
 * Width contract. Every page inside AppShell is `default` (1080px, left aligned in the shell) so titles and content never jump sideways between
 * sidebar items; prose and forms constrain themselves inside it (`max-w-[60ch]`, or a 720px column) instead of narrowing the page.
 * `narrow` (720px, centred) is only for exam-shell screens: the timed session, the live stage and their pre-screens.
 * Wrap the whole page, PageHeader included, so header and body share one edge. Content fades in 4px on route change.
 */
export function PageContainer({ width = 'default', className, ...rest }: ComponentProps<'div'> & { width?: 'default' | 'narrow' }) {
  return <div className={cn('page-enter mx-auto w-full', width === 'narrow' ? WIDTH.reading : WIDTH.page, className)} {...rest} />;
}
