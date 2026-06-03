/**
 * /admin (index) — redirect to /admin/shift-control.
 *
 * Shift Control is the most-used admin page and is what existing
 * /admin bookmarks should land on. Redirect from beforeLoad so the
 * blank index renders nothing before redirecting.
 */
import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_app/admin/')({
  beforeLoad: () => {
    throw redirect({ to: '/admin/shift-control' });
  },
});
