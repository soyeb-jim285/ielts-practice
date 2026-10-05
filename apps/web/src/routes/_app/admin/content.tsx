import { createFileRoute, redirect } from '@tanstack/react-router';

/** Content is the Inventory view under Tests now; the old URL keeps working. */
export const Route = createFileRoute('/_app/admin/content')({
  beforeLoad: () => {
    throw redirect({ to: '/admin/tests', search: { view: 'inventory' }, replace: true });
  },
});
