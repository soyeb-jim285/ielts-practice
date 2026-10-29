import { createFileRoute } from '@tanstack/react-router';
import { COMPANY, LegalPage, Mail, Section } from '@/components/legal/Legal';

export const Route = createFileRoute('/_app/_legal/contact')({ component: Contact });

function Contact() {
  return (
    <LegalPage title="Contact" updated="29 October 2026">
      <Section title={COMPANY.name}>
        <p>
          {COMPANY.product} is a product of {COMPANY.name}, {COMPANY.country}.
        </p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
          <dt className="text-muted">Email</dt>
          <dd><Mail /></dd>
          <dt className="text-muted">Phone</dt>
          <dd><a href={`tel:${COMPANY.phone.replace(/[\s-]/g, '')}`} className="font-medium text-accent-text underline decoration-accent/40 underline-offset-[3px] hover:decoration-accent">{COMPANY.phone}</a></dd>
          <dt className="text-muted">Address</dt>
          <dd>
            <address className="not-italic">{COMPANY.address}</address>
          </dd>
          <dt className="text-muted">Trade licence</dt>
          <dd className="type-num">{COMPANY.tradeLicense}</dd>
        </dl>
        <p>We reply within 2 working days. Phone hours: Saturday to Thursday, 10 am to 6 pm (Bangladesh time). For a payment, include the transaction ID from your receipt.</p>
      </Section>
    </LegalPage>
  );
}
