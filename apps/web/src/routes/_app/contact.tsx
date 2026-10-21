import { createFileRoute } from '@tanstack/react-router';
import { COMPANY, LegalPage, Mail, Section } from '@/components/legal/Legal';

export const Route = createFileRoute('/_app/contact')({ component: Contact });

function Contact() {
  return (
    <LegalPage title="Contact" updated="21 October 2026">
      <Section title={COMPANY.name}>
        <p>
          {COMPANY.product} is a product of {COMPANY.name}, {COMPANY.country}.
        </p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
          <dt className="text-muted">Email</dt>
          <dd><Mail /></dd>
          {COMPANY.phone && (
            <>
              <dt className="text-muted">Phone</dt>
              <dd><a href={`tel:${COMPANY.phone.replace(/\s/g, '')}`} className="font-medium underline underline-offset-2">{COMPANY.phone}</a></dd>
            </>
          )}
          {COMPANY.address && (
            <>
              <dt className="text-muted">Address</dt>
              <dd>{COMPANY.address}</dd>
            </>
          )}
        </dl>
        <p>We reply within 2 working days. For a payment, include the transaction ID from your receipt.</p>
      </Section>
    </LegalPage>
  );
}
