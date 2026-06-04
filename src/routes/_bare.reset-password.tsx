/**
 * /reset-password — landing page for the Supabase password-reset email.
 *
 * The user clicks the link in their inbox, which Supabase auth-js
 * picks up (detectSessionInUrl: true in src/lib/supabase.ts) and
 * fires the PASSWORD_RECOVERY event. From there the user has a brief
 * authenticated session that exists ONLY to call updateUser /
 * set_my_password — the EIA-branded card here just lets them type a
 * new password and confirm it. On success we sign them OUT and bounce
 * them to /login so they can sign in with the new password.
 *
 * Visual: matches the premium EIA login card (#FAFAFB, navy CTA, etc).
 * Logic: uses the same set_my_password RPC (migration 0045) the
 * profile-page change-password flow uses, so the "Auth session
 * missing!" GoTrueClient wedge is avoided.
 */
import { useEffect, useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { Eye, EyeOff } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { safeGetSession } from '@/lib/safeAuth';
import { useAuthStore } from '@/state/authStore';
import { Spinner } from '@/components/Spinner';

export const Route = createFileRoute('/_bare/reset-password')({
  component: ResetPasswordPage,
});

// EIA palette — same scoped tokens as _bare.login.tsx.
const NAVY      = '#1a2547';
const NAVY_DARK = '#11182f';
const BG_APP    = '#FAFAFB';
const BG_CARD   = '#FFFFFF';
const BG_INPUT  = '#FFFFFF';
const BORDER    = '#E5E7EB';
const TEXT_STRONG = '#0F172A';
const TEXT_BODY   = '#1F2937';
const TEXT_MUTED  = '#6B7280';
const FONT_SANS = "'Inter', system-ui, -apple-system, sans-serif";

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [recoverySessionReady, setRecoverySessionReady] = useState(false);
  const [waiting, setWaiting] = useState(true);
  const [password, setPassword]     = useState('');
  const [confirmPw, setConfirmPw]   = useState('');
  const [showPw, setShowPw]         = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Watch for PASSWORD_RECOVERY from Supabase. With detectSessionInUrl
  // = true (lib/supabase.ts), auth-js processes the hash on this page
  // and fires either PASSWORD_RECOVERY (recovery email) or SIGNED_IN
  // (magic-link). Either way, having a session means we can proceed.
  useEffect(() => {
    let cancelled = false;
    // Initial check — if the URL has already been processed before
    // the listener was wired, getSession() returns the new session.
    void (async () => {
      const { data, timedOut } = await safeGetSession('reset-password');
      if (timedOut) {
        if (!cancelled) setWaiting(false);
        return;
      }
      if (!cancelled && data.session) {
        setRecoverySessionReady(true);
        setWaiting(false);
      } else if (!cancelled) {
        // Wait briefly for the event listener below to fire.
        setTimeout(() => { if (!cancelled) setWaiting(false); }, 1500);
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') {
        setRecoverySessionReady(true);
        setWaiting(false);
      }
    });
    return () => { cancelled = true; sub.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    const prev = document.title;
    document.title = 'EIA Internal Projects — Reset password';
    return () => { document.title = prev; };
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8)    { toast.error('Password must be at least 8 characters'); return; }
    if (password !== confirmPw) { toast.error('Passwords do not match'); return; }
    setSubmitting(true);
    try {
      // Use the SECURITY DEFINER RPC (migration 0045) — same as the
      // profile-page change-password flow — to dodge the auth-client
      // wedge that throws "Auth session missing!" intermittently.
      const { error } = await supabase.rpc('set_my_password', { p_new_password: password });
      if (error) throw error;
      toast.success('Password updated. Sign in with your new password.');
      // Clean up the recovery session so the next page is a fresh
      // /login load.
      await useAuthStore.getState().signOut();
      navigate({ to: '/login' });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update password');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        background: BG_APP,
        color: TEXT_BODY,
        fontFamily: FONT_SANS,
        fontSize: '14px',
        minHeight: '100vh',
        margin: '-1px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '48px 16px',
      }}
    >
      <div style={{ width: '100%', maxWidth: '440px' }}>
        <div style={{
          background: BG_CARD, border: `1px solid ${BORDER}`,
          borderRadius: '14px', padding: '36px',
          boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 10px 30px rgba(15,23,42,0.06)',
        }}>
          <h1 style={{
            fontFamily: FONT_SANS, fontWeight: 600, fontSize: '22px',
            color: TEXT_STRONG, margin: '0 0 6px', letterSpacing: '-0.015em',
          }}>Set a new password</h1>
          <p style={{ fontSize: '13.5px', color: TEXT_MUTED, margin: '0 0 24px', lineHeight: 1.5 }}>
            Choose a new password for your EIA Internal Projects account.
          </p>

          {waiting ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', padding: '20px 0' }}>
              <span style={{ color: NAVY, display: 'inline-flex' }}><Spinner className="h-6 w-6" /></span>
              <p style={{ color: TEXT_MUTED, fontSize: '13px', margin: 0 }}>Verifying your link…</p>
            </div>
          ) : !recoverySessionReady ? (
            <div style={{ padding: '6px 0' }}>
              <p style={{ color: TEXT_BODY, fontSize: '14px', margin: '0 0 16px', lineHeight: 1.55 }}>
                This reset link looks expired or has already been used. Start over from sign-in.
              </p>
              <button
                type="button"
                onClick={() => navigate({ to: '/login' })}
                style={{
                  height: '40px', padding: '0 18px',
                  background: 'transparent', color: NAVY, fontSize: '14px', fontWeight: 600,
                  border: `1px solid ${NAVY}`, borderRadius: '8px', cursor: 'pointer',
                }}
              >Back to sign in</button>
            </div>
          ) : (
            <form onSubmit={onSubmit}>
              <label htmlFor="rp-pw" style={{ display: 'block', fontSize: '12.5px', fontWeight: 500, color: TEXT_BODY, marginBottom: '6px' }}>
                New password
              </label>
              <div style={{ position: 'relative', marginBottom: '14px' }}>
                <input
                  id="rp-pw"
                  type={showPw ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  style={{
                    width: '100%', height: '42px', padding: '0 40px 0 12px',
                    background: BG_INPUT, border: `1px solid ${BORDER}`,
                    borderRadius: '8px', color: TEXT_STRONG,
                    fontFamily: FONT_SANS, fontSize: '14px', outline: 'none',
                  }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = NAVY; e.currentTarget.style.boxShadow = `0 0 0 3px ${NAVY}1f`; }}
                  onBlur ={(e) => { e.currentTarget.style.borderColor = BORDER; e.currentTarget.style.boxShadow = 'none'; }}
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  aria-label={showPw ? 'Hide password' : 'Show password'}
                  style={{
                    position: 'absolute', right: '4px', top: '50%', transform: 'translateY(-50%)',
                    width: '34px', height: '34px', display: 'grid', placeItems: 'center',
                    background: 'transparent', border: 'none',
                    color: TEXT_MUTED, cursor: 'pointer', borderRadius: '6px',
                  }}
                >
                  {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <p style={{ color: TEXT_MUTED, fontSize: '11px', margin: '0 0 14px' }}>
                At least 8 characters.
              </p>

              <label htmlFor="rp-pw2" style={{ display: 'block', fontSize: '12.5px', fontWeight: 500, color: TEXT_BODY, marginBottom: '6px' }}>
                Confirm new password
              </label>
              <input
                id="rp-pw2"
                type={showPw ? 'text' : 'password'}
                autoComplete="new-password"
                required
                value={confirmPw}
                onChange={(e) => setConfirmPw(e.target.value)}
                style={{
                  width: '100%', height: '42px', padding: '0 12px',
                  background: BG_INPUT, border: `1px solid ${BORDER}`,
                  borderRadius: '8px', color: TEXT_STRONG,
                  fontFamily: FONT_SANS, fontSize: '14px', outline: 'none', marginBottom: '24px',
                }}
                onFocus={(e) => { e.currentTarget.style.borderColor = NAVY; e.currentTarget.style.boxShadow = `0 0 0 3px ${NAVY}1f`; }}
                onBlur ={(e) => { e.currentTarget.style.borderColor = BORDER; e.currentTarget.style.boxShadow = 'none'; }}
              />

              <button
                type="submit"
                disabled={submitting}
                style={{
                  width: '100%', height: '44px',
                  background: submitting ? NAVY_DARK : NAVY,
                  color: '#FFFFFF', fontFamily: FONT_SANS, fontSize: '14px', fontWeight: 600,
                  border: 'none', borderRadius: '8px',
                  cursor: submitting ? 'wait' : 'pointer',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                  opacity: submitting ? 0.92 : 1,
                }}
                onMouseEnter={(e) => { if (!submitting) e.currentTarget.style.background = NAVY_DARK; }}
                onMouseLeave={(e) => { if (!submitting) e.currentTarget.style.background = NAVY; }}
              >
                {submitting && <Spinner className="h-3 w-3" />}
                {submitting ? 'Updating…' : 'Update password'}
              </button>
            </form>
          )}
        </div>

        <p style={{
          textAlign: 'center', fontStyle: 'italic', color: TEXT_MUTED,
          fontSize: '12px', marginTop: '24px', letterSpacing: '0.01em',
        }}>
          The intelligence layer between humans and AI.
        </p>
      </div>
    </div>
  );
}
