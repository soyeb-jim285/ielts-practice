import { bdt, PAID_PLANS, type PaidPlan } from '@ielts/core';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Lock } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { AccountGate } from '@/components/community/AccountGate';
import { Alert, Button, Card, Input, PageContainer, PageHeader, Segmented } from '@/components/ui';
import { call, client } from '@/lib/api';
import { useAccount } from '@/lib/query';

const isPlan = (v: unknown): v is PaidPlan => typeof v === 'string' && v in PAID_PLANS;

export const Route = createFileRoute('/_app/checkout/')({
  validateSearch: (s: Record<string, unknown>): { plan?: PaidPlan } => (isPlan(s.plan) ? { plan: s.plan } : {}),
  component: () => (useAccount() ? <Checkout /> : <AccountGate what="checkout" />),
});

const link = 'font-medium text-accent-text underline decoration-accent/40 underline-offset-[3px] hover:decoration-accent';
const PHONE = /^(\+?88)?01[3-9]\d{8}$/;

function Checkout() {
  const me = useAccount()!;
  const [plan, setPlan] = useState<PaidPlan>(Route.useSearch().plan ?? 'month');
  const [phone, setPhone] = useState('');
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const p = PAID_PLANS[plan];
  const phoneOk = PHONE.test(phone.replace(/[\s-]/g, ''));

  const pay = async (e: FormEvent) => {
    e.preventDefault();
    if (!phoneOk || !agree) return;
    setBusy(true);
    setError(null);
    try {
      const { url } = await call(client.POST('/api/pay/checkout', { body: { plan, phone: phone.replace(/[\s-]/g, ''), acceptTerms: true } }));
      window.location.assign(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't open the payment page. Try again.");
      setBusy(false);
    }
  };

  return (
    <PageContainer className="max-w-xl">
      <PageHeader title="Checkout" description="NextBand paid plan. You pay on PayStation's secure page and come straight back." />
      <form onSubmit={pay} className="space-y-6">
        <Card className="space-y-5">
          <Segmented
            label="Plan length"
            value={plan}
            onChange={setPlan}
            options={(Object.keys(PAID_PLANS) as PaidPlan[]).map((k) => ({ value: k, label: `${PAID_PLANS[k].label} · ${bdt(PAID_PLANS[k].bdt)}` }))}
          />
          <dl className="grid grid-cols-[1fr_auto] gap-y-2 text-sm">
            <dt className="text-muted">Account</dt>
            <dd className="text-right">{me.user.email}</dd>
            <dt className="text-muted">Plan</dt>
            <dd className="text-right">Paid plan, {p.label} ({p.days} days)</dd>
            <dt className="border-t border-line pt-2 font-medium text-ink">Total</dt>
            <dd className="type-num border-t border-line pt-2 text-right text-lg font-semibold text-ink">{bdt(p.bdt)} BDT</dd>
          </dl>
          <p className="type-caption">One payment, no auto-renewal. VAT included where it applies; no gateway fee is added.</p>
        </Card>

        <Input
          label="Mobile number"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="01712345678"
          hint="PayStation needs it for the payment record."
          error={phone && !phoneOk ? 'Enter a Bangladeshi mobile number, like 01712345678' : undefined}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          required
        />

        <label className="flex items-start gap-3 text-sm leading-6">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} required className="mt-1 size-4 shrink-0 accent-[var(--color-brand)]" />
          <span>
            I have read and agree to the{' '}
            <Link to="/terms" target="_blank" className={link}>
              Terms &amp; Conditions
            </Link>
            , the{' '}
            <Link to="/refunds" target="_blank" className={link}>
              Return &amp; Refund Policy
            </Link>{' '}
            and the{' '}
            <Link to="/privacy" target="_blank" className={link}>
              Privacy Policy
            </Link>
            .
          </span>
        </label>

        {error && <Alert tone="bad">{error}</Alert>}

        <Button type="submit" size="lg" className="w-full" loading={busy} disabled={!agree || !phoneOk} icon={<Lock />}>
          Pay {bdt(p.bdt)}
        </Button>
        <p className="type-caption text-center">bKash, Nagad, Rocket, Upay, Visa and Mastercard, through PayStation.</p>
      </form>
    </PageContainer>
  );
}
