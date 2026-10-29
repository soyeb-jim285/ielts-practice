import { createFileRoute, Link } from '@tanstack/react-router';
import { LegalPage, Section } from '@/components/legal/Legal';
import { FREE, PlanCards } from '@/components/pricing/Plans';

export const Route = createFileRoute('/_app/_legal/pricing')({ component: Pricing });

const link = 'font-medium text-accent-text underline decoration-accent/40 underline-offset-[3px] hover:decoration-accent';

function Pricing() {
  return (
    <LegalPage title="Pricing" updated="29 October 2026">
      <Section title="Plans">
        <p>All prices are in Bangladeshi Taka (BDT) and include VAT where it applies. The price you see is the price you pay: no gateway fee is added.</p>
        <PlanCards />
        <p>
          <span className="font-medium text-ink">Free, with an account:</span> {FREE.join(', ')}.{' '}
          <Link to="/signup" className={link}>
            Create a free account
          </Link>
        </p>
      </Section>

      <Section title="How paying works">
        <ul className="list-disc space-y-2 pl-5 marker:text-accent">
          <li>Pay with bKash, Nagad, Rocket, Upay, or a Visa or Mastercard card, through PayStation.</li>
          <li>The plan starts as soon as the payment is confirmed. Buying again before it ends adds the time to the end.</li>
          <li>
            Plans do not renew by themselves. See the <Link to="/delivery" className={link}>delivery policy</Link> and the{' '}
            <Link to="/refunds" className={link}>refund policy</Link>.
          </li>
        </ul>
      </Section>
    </LegalPage>
  );
}
