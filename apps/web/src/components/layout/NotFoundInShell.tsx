import { Link } from '@tanstack/react-router';
import { Compass } from 'lucide-react';
import { buttonStyles } from '@/components/ui';
import { AppShell } from './AppShell';
import { ErrorPage } from './RouteError';

/** 404 for a signed-in user: the app nav stays. Its own file so __root (and the login entry) doesn't bundle the whole shell. */
export default function NotFoundInShell() {
  return (
    <AppShell>
      <ErrorPage icon={<Compass />} title="Page not found" action={<Link to="/" className={buttonStyles({ variant: 'outline' })}>Back to dashboard</Link>}>
        The link may be old or mistyped.
      </ErrorPage>
    </AppShell>
  );
}
