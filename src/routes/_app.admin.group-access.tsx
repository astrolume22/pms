/**
 * /admin/group-access — per-user × per-group visibility ACL matrix.
 *
 * Reuses GroupAccessSection verbatim.
 */
import { createFileRoute } from '@tanstack/react-router';
import { GroupAccessSection } from '@/components/admin/GroupAccessSection';

export const Route = createFileRoute('/_app/admin/group-access')({
  component: () => <GroupAccessSection />,
});
