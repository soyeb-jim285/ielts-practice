import { createFileRoute, redirect } from '@tanstack/react-router';

/** Funnel is a tab inside Users now; the old URL keeps working. */
export const Route = createFileRoute('/_app/admin/funnel')({
  beforeLoad: ({ search }) => {
    const d = Number((search as { days?: unknown }).days);
    throw redirect({ to: '/admin/users', search: { view: 'funnel', days: d === 7 ? 7 : d === 90 ? 90 : undefined }, replace: true });
  },
});
