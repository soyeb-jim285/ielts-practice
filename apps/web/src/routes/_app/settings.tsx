import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { LogOut, Trash2 } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { AccountGate } from '@/components/community/AccountGate';
import { TargetBandSlider } from '@/components/settings/TargetBandSlider';
import { useUpdateSettings } from '@/components/settings/useUpdateSettings';
import { Button, buttonStyles, Dialog, Input, PageContainer, PageHeader, Switch } from '@/components/ui';
import { authClient, signOut } from '@/lib/auth';
import { useAccount, useMe } from '@/lib/query';
import { cn } from '@/lib/utils';

export const Route = createFileRoute('/_app/settings')({ component: SettingsRoute });

/** Guests have no settings: they get the sign-up gate, not an error. */
function SettingsRoute() {
  return useAccount() ? <SettingsPage /> : <AccountGate what="settings" />;
}

/**
 * One settings group: a left column with the serif heading and what it does, a right column with plain rows between hairlines (no card).
 * Stacks on phones. Rows use the page grid, so every section lines up.
 */
function Section({ title, description, children, className, id }: { title: string; description: string; children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} aria-labelledby={`s-${title}`} className={cn('grid scroll-mt-6 gap-x-12 gap-y-4 border-t border-line pt-8 md:grid-cols-[14rem_minmax(0,1fr)]', className)}>
      <div>
        <h2 id={`s-${title}`} className="type-heading">
          {title}
        </h2>
        <p className="type-caption mt-1.5 max-w-[34ch]">{description}</p>
      </div>
      <div className="min-w-0 max-w-[40rem] divide-y divide-line [&>*:first-child]:pt-0">{children}</div>
    </section>
  );
}
const Row = ({ children }: { children: ReactNode }) => <div className="py-5 first:pt-0 last:pb-0">{children}</div>;
/** Label left, control right (wraps under on phones). */
const InlineRow = ({ title, description, children }: { title: ReactNode; description?: ReactNode; children: ReactNode }) => (
  <Row>
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
      <div className="min-w-0 flex-1 basis-56">
        <p className="text-sm font-medium">{title}</p>
        {description && <p className="type-caption mt-0.5 max-w-[60ch]">{description}</p>}
      </div>
      {children}
    </div>
  </Row>
);

function SettingsPage() {
  const me = useMe().data!;
  const s = me.settings;
  const { mutate } = useUpdateSettings();

  return (
    <PageContainer className="pb-8">
      <PageHeader compact title="Settings" description="Changes save automatically." />
      <div className="space-y-10">
        <Section title="Goal" description="Scores at or above your target show green; up to one band below, amber; further below, red.">
          <Row>
            <TargetBandSlider hint="Most universities ask for 6.5-7.0 overall." />
          </Row>
        </Section>

        <Section title="Writing" description="How the timed essay editor behaves.">
          <Row>
            <Switch label="Submit when time runs out" description="Off: the timer keeps counting as overtime and the result is flagged." checked={s.writingAutoSubmit} onChange={(v) => mutate({ writingAutoSubmit: v })} />
          </Row>
          <Row>
            <Switch label="Block pasting" description="Matches the real test, where you type every word." checked={s.blockPaste} onChange={(v) => mutate({ blockPaste: v })} />
          </Row>
        </Section>

        <Section title="Email" description="Account emails, like sign-in codes, always arrive.">
          <Row>
            <Switch label="Product news and tips" description="New tests, features and practice advice. A few emails a month at most." checked={s.productEmails} onChange={(v) => mutate({ productEmails: v })} />
          </Row>
        </Section>

        <Section title="Appearance" description="Saved in this browser.">
          <InlineRow title="Theme" description="Light, dark, or follow your device.">
            <ThemeToggle />
          </InlineRow>
        </Section>

        <Account email={me.user.email} />
      </div>
    </PageContainer>
  );
}

function Account({ email }: { email: string }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const deleteButton = useRef<HTMLButtonElement>(null);

  const out = async () => {
    await signOut();
    await navigate({ to: '/login' });
  };
  const del = async () => {
    setBusy(true);
    setError(undefined);
    const { error: e } = await authClient.deleteUser({ password });
    setBusy(false);
    if (e) return setError(e.message ?? 'Could not delete the account');
    await out();
  };
  const close = () => {
    setOpen(false);
    setPassword('');
    setError(undefined);
  };

  return (
    <>
      <Section title="Account" description="Your sign-in.">
        <InlineRow title="Signed in as" description={<span className="block truncate">{email}</span>}>
          <Button variant="outline" icon={<LogOut />} onClick={out}>
            Sign out
          </Button>
        </InlineRow>
        <InlineRow title="Privacy policy" description="What we collect, including session recording, and how long we keep it.">
          <Link to="/privacy" className={buttonStyles({ variant: 'outline' })}>
            Read
          </Link>
        </InlineRow>
        <InlineRow title="Terms and refunds" description="The rules for using the service and getting your money back.">
          <Link to="/terms" className={buttonStyles({ variant: 'outline' })}>
            Read
          </Link>
        </InlineRow>
      </Section>
      <Section title="Danger zone" description="Permanent actions.">
        <InlineRow title="Delete account" description="Removes your recordings, essays, results and review cards. This can't be undone.">
          <Button ref={deleteButton} variant="ghost" className="text-bad-text hover:bg-bad-soft hover:text-bad-text" icon={<Trash2 />} onClick={() => setOpen(true)}>
            Delete account
          </Button>
        </InlineRow>
      </Section>
      <Dialog
        open={open}
        onClose={close}
        returnFocusRef={deleteButton}
        title="Delete your account?"
        description="Everything you've recorded and written will be permanently deleted."
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              Keep account
            </Button>
            <Button variant="danger" loading={busy} disabled={!password} onClick={del}>
              Delete forever
            </Button>
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (password) void del();
          }}
        >
          <Input label="Confirm with your password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} error={error} />
        </form>
      </Dialog>
    </>
  );
}
