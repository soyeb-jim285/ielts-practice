import { createFileRoute, redirect } from '@tanstack/react-router';

/** Growth is a tab inside Users now; the old URL keeps working. */
export const Route = createFileRoute('/_app/admin/growth')({
  beforeLoad: ({ search }) => {
    const d = Number((search as { days?: unknown }).days);
    throw redirect({ to: '/admin/users', search: { view: 'growth', days: d === 90 ? 90 : undefined }, replace: true });
  },
});
