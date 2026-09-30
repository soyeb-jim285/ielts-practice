import { Link } from '@tanstack/react-router';
import { ArrowRight, MailCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button, buttonStyles } from '@/components/ui';
import { Logo } from './Logo';

/** Signed-out pages: a left-aligned form column near the top of the viewport, plus (from lg) one real sample of the feedback on a quiet panel. */
export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <main id="main" className="flex flex-col px-5 pt-8 pb-12 sm:px-10 lg:px-16 lg:pt-10">
        <Link to="/login" aria-label="IELTS Practice" className="-m-1 inline-flex w-fit rounded-md p-1">
          <Logo />
        </Link>
        <div className="mt-12 w-full max-w-[26.25rem] page-enter md:mt-[12vh] lg:mx-auto">
          <h1 className="type-title">{title}</h1>
          {subtitle && <p className="type-lede mt-2">{subtitle}</p>}
          <div className="mt-8">{children}</div>
          {footer && <div className="mt-8 border-t border-line pt-6 text-sm text-muted">{footer}</div>}
        </div>
      </main>
      <aside aria-hidden className="hidden border-l border-line bg-sidebar lg:flex lg:flex-col lg:justify-center lg:px-16 xl:px-24">
        <FeedbackSample />
      </aside>
    </div>
  );
}

/** One real sample of what the product does: a sentence from a learner's essay, the error under it, the correction and why. No cards. */
function FeedbackSample() {
  return (
    <figure className="max-w-lg">
      <h2 className="type-display">Every mistake, pinned to the words you wrote.</h2>
      <blockquote className="type-reading mt-10 border-t border-line pt-8">
        Over the last decade, people{' '}
        <span className="underline decoration-bad decoration-wavy decoration-1 underline-offset-[6px]">has become</span> much more aware of how their habits affect the planet.
      </blockquote>
      <figcaption className="mt-5 space-y-1 text-body">
        <p>
          <span className="text-bad-text line-through decoration-1">has become</span>
          <ArrowRight role="img" aria-label="corrected to" className="mx-2 inline size-4 text-muted" />
          <span className="font-medium text-good-text">have become</span>
        </p>
        <p className="type-caption max-w-[46ch]">Subject and verb must agree: the subject is &ldquo;people&rdquo;, which is plural.</p>
      </figcaption>
    </figure>
  );
}

/** "We sent you a link" state for sign-up / password reset. */
export function CheckEmail({ email, onResend }: { email: string; onResend?: () => void }) {
  return (
    <div className="space-y-6">
      <MailCheck className="size-6 text-accent-text" aria-hidden />
      <p className="type-body">
        We sent a link to <span className="font-medium">{email}</span>. Open it on this device to continue. It can take a minute; check spam if it doesn’t show up.
      </p>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        {onResend && (
          <Button variant="outline" onClick={onResend}>
            Resend email
          </Button>
        )}
        <Link to="/login" className={buttonStyles({ variant: 'link', className: 'hit' })}>
          Back to sign in
        </Link>
      </div>
    </div>
  );
}
