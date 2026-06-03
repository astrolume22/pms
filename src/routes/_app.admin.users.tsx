/**
 * /admin/users — user management (add, role, password, deactivate).
 *
 * Reuses UsersSection verbatim.
 */
import { createFileRoute } from '@tanstack/react-router';
import { UsersSection } from '@/components/admin/UsersSection';

export const Route = createFileRoute('/_app/admin/users')({
  component: () => <UsersSection />,
});
