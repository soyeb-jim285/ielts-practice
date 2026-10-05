import { createFileRoute } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { PageContainer, PageHeader } from '@/components/ui';

export const Route = createFileRoute('/_app/privacy')({ component: Privacy });

const CONTACT_EMAIL = 'soyeb.jim@gmail.com';
const UPDATED = '5 October 2026';

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section aria-labelledby={`p-${title}`} className="border-t border-line pt-6">
    <h2 id={`p-${title}`} className="type-heading">
      {title}
    </h2>
    <div className="mt-3 max-w-[65ch] space-y-3 text-sm leading-relaxed">{children}</div>
  </section>
);
const List = ({ children }: { children: ReactNode }) => <ul className="list-disc space-y-1.5 pl-5">{children}</ul>;

function Privacy() {
  return (
    <PageContainer className="pb-8">
      <PageHeader compact title="Privacy policy" description={`Last updated ${UPDATED}.`} />
      <div className="space-y-8">
        <Section title="What we collect">
          <List>
            <li>Your name and email address, when you create an account.</li>
            <li>Your practice: answers, essays, speaking recordings and transcripts, scores and review cards.</li>
            <li>Your settings, and any API keys you add (stored encrypted, never shown back in full).</li>
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
            <li>your API keys;</li>
            <li>audio. Session recording captures no sound at all. The microphone is used only for the speaking test itself.</li>
          </List>
          <p>Recordings are deleted automatically after 14 days. Only the site owner can view them, and we use them only to fix bugs and improve the site.</p>
        </Section>

        <Section title="Other services we send data to">
          <List>
            <li>AI model providers, through OpenRouter and similar services, receive your essays, transcripts and (for the optional pronunciation check) audio so they can score your work.</li>
            <li>Speech and voice providers turn your speech into text and play the examiner&apos;s voice.</li>
            <li>An email service delivers sign-in codes and password resets.</li>
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
          <p>You can ask to see, correct or delete your data at any time. Deleting your account does most of this yourself; for anything else, or any question about this policy, write to <a href={`mailto:${CONTACT_EMAIL}`} className="font-medium underline underline-offset-2">{CONTACT_EMAIL}</a>.</p>
          <p>If we change this policy in a way that matters, we will update the date at the top.</p>
        </Section>
      </div>
    </PageContainer>
  );
}
