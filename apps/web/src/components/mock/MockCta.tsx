import { Link } from '@tanstack/react-router';
import { ArrowRight, ClipboardCheck } from 'lucide-react';
import { RowChevron, RowIcon, rowStyles, RowText } from '@/components/bank/ListRow';
import { buttonStyles, Card } from '@/components/ui';
import { SKILL_LABEL } from '@/lib/mock';
import { cn } from '@/lib/utils';
import { useCurrentMock } from './useMock';

/** "Full mock test" entry: a card on the skill hubs, a row on the dashboard. Shows Continue when a mock is open. */
export function MockCta({ variant = 'card', className }: { variant?: 'card' | 'row'; className?: string }) {
  const mock = useCurrentMock().data;
  const next = mock?.next;
  const title = mock ? 'Continue your mock test' : 'Full mock test';
  const meta = mock ? `${next ? `${SKILL_LABEL[next]} next` : 'Open'}. Pick up where you stopped.` : 'Listening, Reading, Writing and Speaking in one go, with an overall band.';
  const to = mock ? ({ to: '/mock/$id', params: { id: mock.id } } as const) : ({ to: '/mock' } as const);
  if (variant === 'row')
    return (
      <Link {...to} className={cn(rowStyles, className)}>
        <RowIcon>
          <ClipboardCheck />
        </RowIcon>
        <RowText title={title} meta={meta} />
        <RowChevron />
      </Link>
    );
  return (
    <Card className={cn('flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between', className)}>
      <div className="flex min-w-0 items-start gap-3.5">
        <span aria-hidden className="mt-0.5 text-accent-text [&_svg]:size-5">
          <ClipboardCheck />
        </span>
        <div className="min-w-0">
          <p className="type-subheading">{title}</p>
          <p className="type-caption mt-0.5">{meta}</p>
        </div>
      </div>
      <Link {...to} className={buttonStyles({ variant: 'outline', className: 'shrink-0 max-sm:w-full' })}>
        {mock ? 'Continue' : 'Start a mock test'} <ArrowRight aria-hidden />
      </Link>
    </Card>
  );
}
