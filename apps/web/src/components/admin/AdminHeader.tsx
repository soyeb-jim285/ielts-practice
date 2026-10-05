import type { ReactNode } from 'react';
import { PageHeader } from '@/components/ui';

/** Admin page title: the smaller serif title (numbers are the loud thing here), one line of description, controls on the right. */
export const AdminHeader = (p: { title: ReactNode; description?: ReactNode; actions?: ReactNode; back?: ReactNode }) => <PageHeader compact className="mb-6 md:mb-8" {...p} />;
