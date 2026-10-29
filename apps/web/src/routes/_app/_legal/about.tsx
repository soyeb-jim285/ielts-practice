import { createFileRoute, Link } from '@tanstack/react-router';
import { COMPANY, LegalPage, List, Section } from '@/components/legal/Legal';

export const Route = createFileRoute('/_app/_legal/about')({ component: About });

const link = 'font-medium text-accent-text underline decoration-accent/40 underline-offset-[3px] hover:decoration-accent';

function About() {
  return (
    <LegalPage title="About us" updated="29 October 2026">
      <Section title="Who we are">
        <p>
          {COMPANY.name} is a software development business in Mymensingh, {COMPANY.country}, working since {COMPANY.since}. {COMPANY.product} is our product: an IELTS practice platform for students who want to know where they stand before the real test.
        </p>
      </Section>

      <Section title="Why we built it">
        <p>
          Most IELTS candidates in Bangladesh prepare without anyone to mark their writing or listen to their speaking. A tutor is expensive, and a mock test at a centre happens once, if at all. So people practise alone, guess at their band, and find out on test day.
        </p>
        <p>
          We built {COMPANY.product} so that every essay and every spoken answer gets marked against the public IELTS band descriptors, with the reasons spelled out and the mistakes collected, any time of day and at a price a student can pay.
        </p>
      </Section>

      <Section title="What you get">
        <List>
          <li>Speaking practice with a live AI examiner, or recorded answers you can replay, with a band and feedback on each criterion.</li>
          <li>Writing Task 1 and Task 2, scored with corrections you can turn into review cards.</li>
          <li>Full Listening and Reading tests, scored instantly, with where each answer sits in the passage or recording.</li>
          <li>A coach that reads all your tests together and tells you what to work on next.</li>
        </List>
        <p>
          You can start free. The paid plan is on the <Link to="/pricing" className={link}>pricing page</Link>.
        </p>
      </Section>

      <Section title="Company details">
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
          <dt className="text-muted">Business</dt>
          <dd>{COMPANY.name}</dd>
          <dt className="text-muted">Trade licence</dt>
          <dd className="type-num">{COMPANY.tradeLicense}</dd>
          <dt className="text-muted">Address</dt>
          <dd>
            <address className="not-italic">{COMPANY.address}</address>
          </dd>
        </dl>
        <p>
          To reach us, see the <Link to="/contact" className={link}>contact page</Link>.
        </p>
      </Section>
    </LegalPage>
  );
}
