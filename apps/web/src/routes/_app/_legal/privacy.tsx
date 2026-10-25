import { createFileRoute } from '@tanstack/react-router';
import { COMPANY, LegalPage, List, Mail, Section } from '@/components/legal/Legal';

export const Route = createFileRoute('/_app/_legal/privacy')({ component: Privacy });

function Privacy() {
  return (
    <LegalPage title="Privacy policy" updated="21 October 2026">
        <Section title="Who we are">
          <p>{COMPANY.product} is run by {COMPANY.name}, {COMPANY.country}. {COMPANY.name} is responsible for the data described here.</p>
        </Section>

        <Section title="What we collect">
          <List>
            <li>Your name and email address, when you create an account.</li>
            <li>Your practice: answers, essays, speaking recordings and transcripts, scores and review cards.</li>
            <li>Your settings.</li>
            <li>Session recordings and problem reports, described below.</li>
          </List>
          <p>If you practise as a guest, we keep the same things under a temporary guest profile with no name or email.</p>
        </Section>

        <Section title="Session recording">
          <p>To find and fix problems, we record how you use the site. A recording can replay your visit like a video of the page. It includes:</p>
          <List>
            <li>clicks, taps, scrolling and mouse movement;</li>
            <li>the pages you visit;</li>
            <li>what you type into answer boxes and essays.</li>
          </List>
          <p>It never includes:</p>
          <List>
            <li>passwords, or anything on the sign-in, sign-up and password-reset pages;</li>
            <li>audio. Session recording captures no sound at all. The microphone is used only for the speaking test itself.</li>
          </List>
          <p>Recordings are deleted automatically after 14 days. Only the site owner can view them, and we use them only to fix bugs and improve the site.</p>
        </Section>

        <Section title="Other services we send data to">
          <List>
            <li>AI model providers, through OpenRouter and similar services, receive your essays, transcripts and (for the optional pronunciation check) audio so they can score your work.</li>
            <li>Speech and voice providers turn your speech into text and play the examiner&apos;s voice.</li>
            <li>An email service delivers sign-in codes and password resets.</li>
            <li>Payment providers (such as bKash, SSLCommerz or Paddle) process your payments. We receive the amount, the status and a transaction ID, never your full card or wallet details.</li>
          </List>
          <p>We do not sell your data and we do not show ads.</p>
        </Section>

        <Section title="How long we keep it">
          <List>
            <li>Session recordings: 14 days.</li>
            <li>Guest data: 30 days.</li>
            <li>Everything else: until you delete your account. Deleting it (Settings, Danger zone) removes your tests, recordings, results and review cards.</li>
          </List>
        </Section>

        <Section title="Your rights and contact">
          <p>You can ask to see, correct or delete your data at any time. Deleting your account does most of this yourself; for anything else, or any question about this policy, write to <Mail />.</p>
          <p>If we change this policy in a way that matters, we will update the date at the top.</p>
        </Section>
    </LegalPage>
  );
}
