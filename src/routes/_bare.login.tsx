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
  const signIn = useAuthStore((s) => s.signInWithIdentifier);

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [showPw, setShowPw] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identifier.trim() || !password) {
      toast.error('Enter your username or email and password');
      return;
    }
    setSubmitting(true);
    try {
      await signIn(identifier, password, remember);
      navigate({ to: redirectTarget || '/' });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Invalid username/email or password');
    } finally {
      setSubmitting(false);
    }
  };

  // ---------------------------------------------------------------------
  // EIA brand palette — scoped to this page only via inline styles so the
  // rest of the app's dark theme is untouched. Don't promote these to
  // tokens.css; the login is intentionally an island of light.
  // ---------------------------------------------------------------------
  const NAVY       = '#1a2547';
  const NAVY_DARK  = '#11182f';
  const CREAM      = '#FAF8F3';
  const FIELD_BG   = '#EEF1F8';
  const FIELD_BORD = '#D7DCEA';
  const GOLD       = '#b08d57';
  const MUTED      = '#6B7280';
  const SERIF = "'Cormorant Garamond', 'EB Garamond', Georgia, 'Times New Roman', serif";

  return (
    <div
      // Override the dark _bare layout's bg-app/text-text-primary on the
      // login route only — keeps the in-app dark theme intact.
      className="flex-1 flex items-center justify-center px-4 py-12 -m-px"
      style={{ background: CREAM, color: NAVY, minHeight: '100vh' }}
    >
      <div className="w-full" style={{ maxWidth: '440px' }}>
        <form
          onSubmit={onSubmit}
          style={{
            background: '#FFFFFF',
            border: '1px solid #ECE7DA',
            borderRadius: '12px',
            boxShadow: '0 10px 40px -16px rgba(26,37,71,0.18), 0 2px 6px -2px rgba(26,37,71,0.06)',
            padding: '40px',
          }}
        >
          {/* ----- EIA wordmark + company name + tagline + gold divider ----- */}
          <div style={{ textAlign: 'center', marginBottom: '28px' }}>
            <h1
              style={{
                fontFamily: SERIF,
                fontWeight: 500,
                color: NAVY,
                fontSize: '56px',
                lineHeight: 1,
                letterSpacing: '0.08em',
                margin: 0,
              }}
            >
              EIA
            </h1>
            <p
              style={{
                fontFamily: SERIF,
                fontWeight: 500,
                color: NAVY,
                fontSize: '17px',
                letterSpacing: '0.02em',
                marginTop: '10px',
                marginBottom: 0,
              }}
            >
              Expert Intuitive Advisor Inc.
            </p>
            <p
              style={{
                fontStyle: 'italic',
                color: MUTED,
                fontSize: '11px',
                letterSpacing: '0.2em',
                textTransform: 'uppercase',
                marginTop: '14px',
                marginBottom: 0,
              }}
            >
              Internal Project Management System
            </p>
            <div
              aria-hidden
              style={{
                width: '60px',
                height: '2px',
                background: GOLD,
                margin: '20px auto 0',
                borderRadius: '1px',
              }}
            />
          </div>

          <h2
            style={{
              textAlign: 'center',
              color: NAVY,
              fontSize: '18px',
              fontWeight: 700,
              margin: '0 0 24px 0',
            }}
          >
            Sign in to continue
          </h2>

          {/* ----- Username or email ----- */}
          <label className="block" style={{ marginBottom: '16px' }}>
            <span
              style={{
                display: 'block',
                color: NAVY,
                fontSize: '12px',
                fontWeight: 600,
                marginBottom: '6px',
                letterSpacing: '0.01em',
              }}
            >
              Username or email
            </span>
            <input
              type="text"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              autoFocus
              autoComplete="username"
              spellCheck={false}
              required
              style={{
                width: '100%',
                height: '48px',
                background: FIELD_BG,
                border: `1px solid ${FIELD_BORD}`,
                borderRadius: '8px',
                padding: '0 14px',
                color: NAVY,
                fontSize: '14px',
                outline: 'none',
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = NAVY; e.currentTarget.style.boxShadow = `0 0 0 3px ${NAVY}1a`; }}
              onBlur={(e)  => { e.currentTarget.style.borderColor = FIELD_BORD; e.currentTarget.style.boxShadow = 'none'; }}
            />
          </label>

          {/* ----- Password (with eye toggle, behavior unchanged) ----- */}
          <label className="block" style={{ marginBottom: '14px' }}>
            <span
              style={{
                display: 'block',
                color: NAVY,
                fontSize: '12px',
                fontWeight: 600,
                marginBottom: '6px',
                letterSpacing: '0.01em',
              }}
            >
              Password
            </span>
            <div style={{ position: 'relative' }}>
              <input
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                style={{
                  width: '100%',
                  height: '48px',
                  background: FIELD_BG,
                  border: `1px solid ${FIELD_BORD}`,
                  borderRadius: '8px',
                  padding: '0 44px 0 14px',
                  color: NAVY,
                  fontSize: '14px',
                  outline: 'none',
                }}
                onFocus={(e) => { e.currentTarget.style.borderColor = NAVY; e.currentTarget.style.boxShadow = `0 0 0 3px ${NAVY}1a`; }}
                onBlur={(e)  => { e.currentTarget.style.borderColor = FIELD_BORD; e.currentTarget.style.boxShadow = 'none'; }}
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                aria-label={showPw ? 'Hide password' : 'Show password'}
                tabIndex={-1}
                style={{
                  position: 'absolute',
                  right: '8px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  height: '32px',
                  width: '32px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: '6px',
                  color: MUTED,
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#E1E7F2'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </label>

          {/* ----- Remember me (behavior unchanged) ----- */}
          <label
            className="select-none cursor-pointer"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginBottom: '24px',
              color: MUTED,
              fontSize: '13px',
            }}
          >
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              style={{ width: '16px', height: '16px', accentColor: NAVY }}
            />
            <span>Remember me</span>
          </label>

          {/* ----- Sign-in button ----- */}
          <button
            type="submit"
            disabled={submitting}
            style={{
              width: '100%',
              height: '50px',
              background: submitting ? NAVY_DARK : NAVY,
              color: '#FFFFFF',
              fontSize: '15px',
              fontWeight: 700,
              letterSpacing: '0.02em',
              border: 'none',
              borderRadius: '8px',
              cursor: submitting ? 'not-allowed' : 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              transition: 'background 0.15s ease',
            }}
            onMouseEnter={(e) => { if (!submitting) e.currentTarget.style.background = NAVY_DARK; }}
            onMouseLeave={(e) => { if (!submitting) e.currentTarget.style.background = NAVY; }}
          >
            {submitting && <Spinner className="h-3 w-3" />}
            Sign in
          </button>
        </form>

        {/* ----- Footer tagline ----- */}
        <p
          style={{
            textAlign: 'center',
            fontStyle: 'italic',
            color: MUTED,
            fontSize: '12px',
            marginTop: '28px',
            letterSpacing: '0.01em',
          }}
        >
          The intelligence layer between humans and AI.
        </p>
      </div>
    </div>
  );
}
