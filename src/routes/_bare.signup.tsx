import { createFileRoute, redirect } from '@tanstack/react-router';

// No public signup in V1. Anyone arriving here gets bounced to login.
export const Route = createFileRoute('/_bare/signup')({
  beforeLoad: () => {
    throw redirect({ to: '/login' });
  },
});
