import { createFileRoute } from '@tanstack/react-router';
import { COMPANY, LegalPage, List, Mail, Section } from '@/components/legal/Legal';

export const Route = createFileRoute('/_app/_legal/refunds')({ component: Refunds });

function Refunds() {
  return (
    <LegalPage title="Refund policy" updated="29 October 2026">
      <Section title="Summary">
        <p>
          {COMPANY.product} is a digital service sold by {COMPANY.name}. Nothing is shipped. If something goes wrong, or you change your mind before using what you bought, we will put it right.
        </p>
      </Section>

      <Section title="When you get a refund">
        <List>
          <li>You bought a plan and have not used any of it: full refund if you ask within 7 days of paying.</li>
          <li>You were charged twice, or charged for something you did not receive: full refund of the extra charge.</li>
          <li>A paid test failed to score because of a fault on our side: we give the credit back, or refund that test if you prefer.</li>
          <li>Plans do not renew by themselves, so there is nothing to cancel. You keep access until the end of the period you paid for.</li>
        </List>
      </Section>

      <Section title="When we can't refund">
        <List>
          <li>Credits or tests you have already used.</li>
          <li>Disagreeing with a band score. Scores are practice estimates, as the terms explain.</li>
          <li>Requests made more than 7 days after payment, unless the law says otherwise or we made a mistake.</li>
        </List>
      </Section>

      <Section title="How to ask">
        <p>
          Email <Mail /> from your account&apos;s email address. Include the date, the amount and the transaction ID from your payment confirmation or your bKash, Nagad or card statement.
        </p>
        <List>
          <li>We reply within 2 working days.</li>
          <li>Approved refunds go back to the method you paid with, usually within 7–10 working days. Your bank or wallet provider sets the exact time.</li>
        </List>
      </Section>
    </LegalPage>
  );
}
