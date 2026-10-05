import { Link, useRouterState } from '@tanstack/react-router';
import { ClipboardCheck, History, Layers, Settings, TriangleAlert, type LucideIcon } from 'lucide-react';
import { buttonStyles, EmptyState, PageContainer, PageHeader } from '@/components/ui';

const WHAT: Record<'history' | 'mistakes' | 'review' | 'settings' | 'mock', { title: string; page: string; icon: LucideIcon; heading: string; body: string }> = {
  history: { title: 'Create an account to see your history', page: 'History', icon: History, heading: 'History', body: 'Every test you take is kept with your account, so you can open an old result and see how your bands move.' },
  mistakes: { title: 'Create an account to see your mistakes', page: 'Mistakes', icon: TriangleAlert, heading: 'Mistakes', body: 'Your repeated errors are collected across all your tests, so you know what to fix first.' },
  review: { title: 'Create an account to build a review deck', page: 'Review', icon: Layers, heading: 'Review', body: 'Turn your corrections into flashcards that come back just before you forget them.' },
  mock: { title: 'Create an account to take a full mock test', page: 'Mock', icon: ClipboardCheck, heading: 'Full mock test', body: 'A mock test runs over several sections and days, and keeps your place and your bands with your account.' },
  settings: { title: 'Create an account to change settings', page: 'Settings', icon: Settings, heading: 'Settings', body: 'Your target band, examiner and your own API keys live in your account.' },
};

/** What a guest sees instead of a personal page: what it is for and the way to get it. Never an error, never a redirect. */
export function AccountGate({ what }: { what: keyof typeof WHAT }) {
  const redirect = useRouterState({ select: (s) => s.location.href });
  const w = WHAT[what];
  const Icon = w.icon;
  return (
    <PageContainer>
      <PageHeader title={w.heading} />
      <EmptyState
        icon={<Icon />}
        title={w.title}
        action={
          <div className="flex flex-col gap-2 sm:flex-row">
            <Link to="/signup" search={{ redirect }} className={buttonStyles({ size: 'lg', className: 'max-sm:w-full' })}>
              Create account
            </Link>
            <Link to="/login" search={{ redirect }} className={buttonStyles({ variant: 'outline', size: 'lg', className: 'max-sm:w-full' })}>
              Sign in
            </Link>
          </div>
        }
      >
        {w.body}
      </EmptyState>
    </PageContainer>
  );
}
