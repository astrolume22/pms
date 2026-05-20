import { createFileRoute, redirect } from '@tanstack/react-router';
import { useEffect } from 'react';
import { AppShell } from '@/components/shell/AppShell';
import { useAuthStore } from '@/state/authStore';
import { useThemeStore } from '@/state/themeStore';
import { FullPageSpinner } from '@/components/Spinner';

export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ location }) => {
    // Wait for the auth store to resolve at least once.
    const state = useAuthStore.getState();
    if (state.status === 'loading') {
      await state.initialize();
    }
    const after = useAuthStore.getState();
    if (after.status !== 'authenticated' || !after.profile) {
      const redirectTarget = location.pathname + (location.searchStr ?? '');
      throw redirect({ to: '/login', search: { redirect: redirectTarget } });
    }
  },
  component: AppLayout,
});

function AppLayout() {
  const status = useAuthStore((s) => s.status);
  const profileTheme = useAuthStore((s) => s.profile?.theme);
  const hydrate = useThemeStore((s) => s.hydrateFromProfile);

  // Sync theme from the user's saved preference once we have a profile.
  useEffect(() => {
    if (profileTheme) hydrate(profileTheme);
  }, [profileTheme, hydrate]);

  if (status === 'loading') return <FullPageSpinner />;
  return <AppShell />;
}
