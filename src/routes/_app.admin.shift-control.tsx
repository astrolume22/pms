/**
 * /admin/shift-control — live shift management.
 *
 * Reuses the existing AdminShiftControlSection component verbatim. Per
 * the restructure spec, the (small) bio-break request approve/deny
 * queue stays embedded inside that component since admins approving a
 * bio request are typically already looking at the live shift state.
 */
import { createFileRoute } from '@tanstack/react-router';
import { AdminShiftControlSection } from '@/components/admin/AdminShiftControlSection';

export const Route = createFileRoute('/_app/admin/shift-control')({
  component: () => <AdminShiftControlSection />,
});
