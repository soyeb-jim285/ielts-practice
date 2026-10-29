import { createFileRoute, Link } from '@tanstack/react-router';
import { COMPANY, LegalPage, List, Mail, Section } from '@/components/legal/Legal';

export const Route = createFileRoute('/_app/_legal/delivery')({ component: Delivery });

const link = 'font-medium text-accent-text underline decoration-accent/40 underline-offset-[3px] hover:decoration-accent';

function Delivery() {
  return (
    <LegalPage title="Delivery policy" updated="29 October 2026">
      <Section title="What we deliver">
        <p>
          {COMPANY.product} is an online service. There are no physical goods and nothing is shipped, so there are no delivery charges. What you buy is access to the paid plan on your {COMPANY.product} account for the period you choose.
        </p>
      </Section>

      <Section title="When you get it">
        <List>
          <li>Access starts as soon as your payment is confirmed, usually within a minute. You are taken back to {COMPANY.product} and the plan shows in your account.</li>
          <li>We also send a confirmation to your account&apos;s email address, with the date your plan ends.</li>
          <li>If you already have time left on a plan, the new period is added to the end of it.</li>
          <li>You use the service on the website or in the {COMPANY.product} apps, from anywhere, with an internet connection.</li>
        </List>
      </Section>

      <Section title="If it doesn't arrive">
        <p>
          Sometimes a bank or wallet takes longer to confirm a payment. If your plan is not on within 2 hours of paying, email <Mail /> with the transaction ID from your bKash, Nagad or card statement. We will turn it on or refund you under the{' '}
          <Link to="/refunds" className={link}>refund policy</Link>.
        </p>
      </Section>
    </LegalPage>
  );
}
