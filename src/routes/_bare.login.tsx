import { useState } from 'react';
import { createFileRoute, useNavigate, redirect } from '@tanstack/react-router';
import { Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '@/state/authStore';
import { Spinner } from '@/components/Spinner';

interface LoginSearch {
  redirect?: string;
}

export const Route = createFileRoute('/_bare/login')({
  validateSearch: (search: Record<string, unknown>): LoginSearch => ({
    redirect: typeof search.redirect === 'string' ? search.redirect : undefined,
  }),
  beforeLoad: async ({ search }) => {
    // If already signed in, bounce to the originally-requested URL (or home).
    const auth = useAuthStore.getState();
    if (auth.status === 'loading') await auth.initialize();
    const after = useAuthStore.getState();
    if (after.status === 'authenticated') {
      throw redirect({ to: (search.redirect as string) || '/' });
    }
  },
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const { redirect: redirectTarget } = Route.useSearch();
  const signIn = useAuthStore((s) => s.signInWithUsername);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [showPw, setShowPw] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      toast.error('Enter username and password');
      return;
    }
    setSubmitting(true);
    try {
      await signIn(username, password, remember);
      navigate({ to: redirectTarget || '/' });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Username or password incorrect');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex-1 flex items-center justify-center px-4">
      <div className="w-full max-w-[400px]">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold tracking-wide">PMS</h1>
          <p className="text-sm text-text-secondary mt-1">Project Management System</p>
        </div>

        <form
          onSubmit={onSubmit}
          className="bg-surface border border-border-light rounded-md shadow-md p-8"
        >
          <h2 className="text-xl font-semibold mb-1">Sign in</h2>
          <p className="text-sm text-text-secondary mb-6">Enter your username and password to continue.</p>

          <label className="block mb-4">
            <span className="block text-xs uppercase tracking-wide text-text-secondary font-medium mb-1">Username</span>
            <input
              type="text"
              className="input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              autoComplete="username"
              spellCheck={false}
              required
            />
          </label>

          <label className="block mb-3">
            <span className="block text-xs uppercase tracking-wide text-text-secondary font-medium mb-1">Password</span>
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'}
                className="input pr-10"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                aria-label={showPw ? 'Hide password' : 'Show password'}
                className="absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7 inline-flex items-center justify-center rounded-base text-text-secondary hover:bg-hover"
                tabIndex={-1}
              >
                {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </label>

          <label className="flex items-center gap-2 mb-6 select-none cursor-pointer">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="h-4 w-4 rounded accent-brand"
            />
            <span className="text-sm text-text-secondary">Remember me</span>
          </label>

          <button
            type="submit"
            disabled={submitting}
            className="btn-primary w-full"
          >
            {submitting && <Spinner className="h-3 w-3 mr-2" />}
            Sign in
          </button>
        </form>

        <p className="text-xs text-text-secondary text-center mt-6">
          Access is invitation-only. Contact your admin to get an account.
        </p>
      </div>
    </div>
  );
}
