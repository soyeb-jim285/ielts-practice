import { Link } from '@tanstack/react-router';
import { MailCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui';
import { Logo } from './Logo';

/** Signed-out pages: form column + (≥lg) a quiet preview of what feedback looks like. */
export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="flex flex-col px-5 py-8 sm:px-10">
        <Link to="/login" className="self-start">
          <Logo />
        </Link>
        <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-12">
          <h1 className="text-[1.75rem] font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-2 text-[0.9375rem] text-muted">{subtitle}</p>}
          <div className="mt-8">{children}</div>
          {footer && <div className="mt-8 text-sm text-muted">{footer}</div>}
        </main>
      </div>
      <aside aria-hidden className="relative hidden overflow-hidden border-l border-line bg-surface-2 lg:flex lg:items-center lg:justify-center lg:p-12">
        <FeedbackPreview />
      </aside>
    </div>
  );
}

/** Static illustration of a result: one criterion + an annotated transcript line. */
function FeedbackPreview() {
  return (
    <div className="w-full max-w-md space-y-4">
      <div className="rounded-card border border-line bg-surface p-5 shadow-pop">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-medium text-muted">Fluency &amp; Coherence</span>
          <span className="rounded-full bg-warn-soft px-2.5 py-0.5 text-xs font-medium text-warn-text">likely 6–7</span>
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-5xl font-semibold tracking-tight tabular-nums">6.5</span>
          <span className="text-sm text-muted">target 7.0</span>
        </div>
        <p className="mt-3 font-serif text-[0.9375rem] leading-relaxed text-muted italic">“willing to speak at length, though may lose coherence at times due to occasional repetition”</p>
      </div>
      <div className="ml-8 rounded-card border border-line bg-surface p-5 shadow-card">
        <p className="font-serif text-[1.0625rem] leading-loose">
          I think the main reason is{' '}
          <span className="rounded-sm bg-ink/6 px-1 font-sans text-xs text-muted tabular-nums">⏸ 1.8s</span> that people{' '}
          <span className="underline decoration-bad decoration-2 underline-offset-4">has become</span> more <span className="text-muted line-through decoration-muted/60">um</span> aware of it.
        </p>
        <div className="mt-4 rounded-control bg-surface-2 p-3 text-sm">
          <span className="text-bad-text line-through">has become</span> → <span className="font-medium text-good-text">have become</span>
          <p className="mt-1 text-xs text-muted">Subject–verb agreement: “people” is plural.</p>
        </div>
      </div>
      <p className="px-2 text-center text-sm text-muted">Every mistake pinned to the second you said it.</p>
    </div>
  );
}

/** "We sent you a link" state for sign-up / password reset. */
export function CheckEmail({ email, onResend }: { email: string; onResend?: () => void }) {
  return (
    <div className="space-y-6">
      <div className="grid size-12 place-items-center rounded-full bg-accent-soft text-accent-text">
        <MailCheck className="size-6" aria-hidden />
      </div>
      <p className="text-[0.9375rem]">
        We sent a link to <span className="font-medium">{email}</span>. Open it on this device to continue. It can take a minute; check spam if it doesn’t show up.
      </p>
      <div className="flex flex-wrap gap-3 text-sm">
        {onResend && (
          <Button variant="secondary" onClick={onResend}>
            Resend email
          </Button>
        )}
        <Link to="/login" className="inline-flex h-10 items-center px-2 font-medium text-accent-text hover:underline">
          Back to sign in
        </Link>
      </div>
    </div>
  );
}
