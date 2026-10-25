import { createFileRoute, Link } from '@tanstack/react-router';
import { COMPANY, LegalPage, List, Mail, Section, TRADEMARK } from '@/components/legal/Legal';

export const Route = createFileRoute('/_app/_legal/terms')({ component: Terms });

const link = 'font-medium text-accent-text underline decoration-accent/40 underline-offset-[3px] hover:decoration-accent';

function Terms() {
  return (
    <LegalPage title="Terms of service" updated="21 October 2026">
      <Section title="Who we are">
        <p>
          {COMPANY.product} is a product of {COMPANY.name}, a business registered in {COMPANY.country} (&quot;we&quot;, &quot;us&quot;). These terms apply when you use the website or the apps. By using them you agree to these terms and to our{' '}
          <Link to="/privacy" className={link}>privacy policy</Link>.
        </p>
      </Section>

      <Section title="The service">
        <p>{COMPANY.product} gives you practice tests for IELTS Speaking, Writing, Listening and Reading, with scores and feedback produced by AI.</p>
        <List>
          <li>Scores are estimates to guide your practice. They are not official IELTS results, and a real test may give you a different band.</li>
          <li>AI feedback can be wrong. Use your own judgement, and a teacher&apos;s if you have one.</li>
          <li>We may add, change or remove features, tests and prices. We will not take away something you have already paid for without a refund.</li>
        </List>
      </Section>

      <Section title="Your account">
        <List>
          <li>Keep your sign-in details private. You are responsible for what happens under your account.</li>
          <li>Give a real email address so we can reach you about your account and payments.</li>
          <li>You can delete your account at any time in Settings.</li>
        </List>
      </Section>

      <Section title="Fair use">
        <p>Please don&apos;t:</p>
        <List>
          <li>copy, resell or republish our tests, questions, audio or feedback;</li>
          <li>share a paid account, or use scripts or bots to use the service;</li>
          <li>try to break, overload or get around the limits of the service;</li>
          <li>upload anything unlawful, or anything that isn&apos;t yours to share.</li>
        </List>
        <p>We may suspend an account that breaks these rules. If we do, we will tell you why.</p>
      </Section>

      <Section title="Payments">
        <List>
          <li>Prices are shown before you pay, including VAT where it applies.</li>
          <li>Payments are handled by our payment providers (for example bKash, SSLCommerz or Paddle). We never see or store your full card or wallet details.</li>
          <li>
            Refunds follow our <Link to="/refunds" className={link}>refund policy</Link>.
          </li>
        </List>
      </Section>

      <Section title="Your content">
        <p>Your answers, essays and recordings stay yours. You let us store and process them to score your work, show you your history and improve the service, as described in the privacy policy.</p>
      </Section>

      <Section title="Liability">
        <p>We work to keep the service accurate and available, but we provide it &quot;as is&quot;. To the extent the law allows, we are not liable for indirect losses, or for decisions you make based on a practice score. Our total liability to you is limited to what you paid us in the 12 months before the claim.</p>
      </Section>

      <Section title="Law and changes">
        <p>These terms are governed by the laws of {COMPANY.country}, and the courts of Dhaka have jurisdiction. If we change them in a way that matters, we will update the date at the top and, for paid users, tell you by email.</p>
      </Section>

      <Section title="Trademark">
        <p>{TRADEMARK}</p>
      </Section>

      <Section title="Contact">
        <p>
          Questions about these terms: <Mail />. See also our <Link to="/contact" className={link}>contact page</Link>.
        </p>
      </Section>
    </LegalPage>
  );
}
