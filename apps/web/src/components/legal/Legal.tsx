import type { ReactNode } from 'react';
import { PageContainer, PageHeader } from '@/components/ui';

/** The business behind the site, as shown on the legal pages and in the footer. Fill in `address` and `phone` before applying to a gateway. */
export const COMPANY = {
  name: 'Dolphin Commerce',
  product: 'IELTS Practice',
  email: 'support@dolphincommerce.com',
  address: '', // ponytail: shown only once set; payment gateways ask for a postal address
  phone: '',
  country: 'Bangladesh',
};

export const TRADEMARK =
  'IELTS is a registered trademark of the British Council, IDP: IELTS Australia and Cambridge University Press & Assessment. IELTS Practice is not affiliated with, approved or endorsed by them.';

export const Mail = () => (
  <a href={`mailto:${COMPANY.email}`} className="font-medium underline underline-offset-2">
    {COMPANY.email}
  </a>
);

export const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section aria-labelledby={`p-${title}`} className="border-t border-line pt-6">
    <h2 id={`p-${title}`} className="type-heading">
      {title}
    </h2>
    <div className="mt-3 max-w-[65ch] space-y-3 text-sm leading-relaxed">{children}</div>
  </section>
);

export const List = ({ children }: { children: ReactNode }) => <ul className="list-disc space-y-1.5 pl-5">{children}</ul>;

export const LegalPage = ({ title, updated, children }: { title: string; updated: string; children: ReactNode }) => (
  <PageContainer className="pb-8">
    <PageHeader compact title={title} description={`Last updated ${updated}.`} />
    <div className="space-y-8">{children}</div>
  </PageContainer>
);
