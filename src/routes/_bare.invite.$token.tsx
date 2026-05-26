/**
 * Public route — recipient of an invite link lands here without an
 * account. We validate the token via the anon-safe RPC
 * `get_invite_by_token`, then let them claim it by entering a full
 * name + password (the username is auto-generated server-side per
 * migration 0042). On success we sign them in and bounce to the app
 * (or directly into the inviting board, if board-specific).
 *
 * Visual design mirrors src/routes/_bare.login.tsx (premium EIA look)
 * so the sign-in + invite-accept pages feel like one branded system.
 * All inline-styled and scoped to this route so the rest of the app's
 * dark theme stays intact.
 */
import { useEffect, useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { Eye, EyeOff, AlertTriangle } from 'lucide-react';
import { useInviteByToken, useAcceptInvite } from '@/hooks/invites';
import { useAuthStore } from '@/state/authStore';
import { RoleBadge } from '@/components/RoleBadge';
import { Spinner } from '@/components/Spinner';

export const Route = createFileRoute('/_bare/invite/$token')({
  component: InvitePage,
});

// ---------------------------------------------------------------------
// EIA brand palette — copied verbatim from _bare.login.tsx so the two
// pages match pixel-by-pixel. Scoped via inline styles to this route
// only; the in-app dark theme stays untouched.
// ---------------------------------------------------------------------
const NAVY       = '#1a2547';
const NAVY_DARK  = '#11182f';
const CREAM      = '#FAF8F3';
const FIELD_BG   = '#EEF1F8';
const FIELD_BORD = '#D7DCEA';
const GOLD       = '#b08d57';
const MUTED      = '#6B7280';
const SERIF = "'Cormorant Garamond', 'EB Garamond', Georgia, 'Times New Roman', serif";

function InvitePage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const signIn = useAuthStore((s) => s.signInWithIdentifier);

  const { data: check, isLoading } = useInviteByToken(token);
  const accept = useAcceptInvite();

  // 0042: the username is auto-generated server-side from the invite's
  // invitee_email / full_name / a "user####" fallback. The invitee only
  // types full name + password.
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // If the visitor is already signed in, bounce them to the board (or home)
  // — they don't need a new account.
  const authStatus = useAuthStore((s) => s.status);
  useEffect(() => {
    if (authStatus === 'authenticated' && check?.valid) {
      // Already authed — surface a friendly note + send them to the board.
      toast.info('You\'re already signed in — opening the inviting board.');
      if (check.board_id) {
        navigate({
          to: '/w/$workspace/b/$boardId',
          params: { workspace: 'main', boardId: check.board_id },
        });
      } else {
        navigate({ to: '/' });
      }
    }
  }, [authStatus, check?.valid, check?.board_id, navigate]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }
    setSubmitting(true);
    try {
      const result = await accept.mutateAsync({
        token, fullName: fullName.trim(), password,
      });
      // ISSUE B fix — sign in by the authoritative email that accept_invite
      // just returned. This skips the resolve_login_email round-trip and
      // any dependence on the just-committed row being visible to that
      // lookup, which was making the auto-login fragile.
      await signIn(result.email, password, true);
      toast.success(`Welcome, @${result.username}!`);
      if (result.board_id) {
        navigate({
          to: '/w/$workspace/b/$boardId',
          params: { workspace: 'main', boardId: result.board_id },
        });
      } else {
        navigate({ to: '/' });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not redeem invite');
    } finally {
      setSubmitting(false);
    }
  };

  // ---------- Loading ----------
  if (isLoading) {
    return (
      <BrandCard>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', padding: '24px 0' }}>
          {/* Spinner inherits `currentColor` for its ring → wrap in a span
              that sets text color to navy so the spinner matches the
              brand without changing Spinner's API. */}
          <span style={{ color: NAVY, display: 'inline-flex' }}>
            <Spinner className="h-7 w-7" />
          </span>
          <p style={{ color: MUTED, fontSize: '13px', margin: 0 }}>Checking invite link…</p>
        </div>
      </BrandCard>
    );
  }

  // ---------- Invalid ----------
  if (!check?.valid) {
    return (
      <BrandCard>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: '12px', padding: '8px 0' }}>
          <AlertTriangle style={{ width: '40px', height: '40px', color: GOLD }} aria-hidden />
          <h2 style={{ color: NAVY, fontSize: '18px', fontWeight: 700, margin: 0 }}>
            {reasonTitle(check?.reason)}
          </h2>
          <p style={{ color: MUTED, fontSize: '13px', lineHeight: '20px', margin: 0, maxWidth: '320px' }}>
            {reasonDescription(check?.reason)} Ask the admin who shared the link to generate a fresh one.
          </p>
          <button
            type="button"
            onClick={() => navigate({ to: '/login' })}
            style={{
              marginTop: '8px',
              height: '40px',
              padding: '0 18px',
              background: 'transparent',
              color: NAVY,
              fontSize: '14px',
              fontWeight: 600,
              border: `1px solid ${NAVY}`,
              borderRadius: '8px',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = NAVY; e.currentTarget.style.color = '#FFFFFF'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = NAVY; }}
          >
            Go to sign in
          </button>
        </div>
      </BrandCard>
    );
  }

  // ---------- Already authed redirect happens in useEffect ----------

  // ---------- Valid: accept form ----------
  return (
    <BrandCard>
      {/* Heading + role/board chip row */}
      <h2 style={{ textAlign: 'center', color: NAVY, fontSize: '18px', fontWeight: 700, margin: '0 0 8px 0' }}>
        Complete your account
      </h2>
      <p style={{ textAlign: 'center', color: MUTED, fontSize: '13px', margin: '0 0 20px 0' }}>
        You've been invited to EIA Projects.
      </p>

      {(check.role || check.board_name) && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: '8px', marginBottom: '24px',
          fontSize: '13px', color: MUTED,
        }}>
          <span>You'll join as</span>
          {check.role && <RoleBadge role={check.role} />}
          {check.board_name && (
            <>
              <span style={{ color: MUTED }}>·</span>
              <span style={{ color: NAVY, fontWeight: 600, maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {check.board_name}
              </span>
            </>
          )}
        </div>
      )}

      <form onSubmit={(e) => void onSubmit(e)}>
        {/* Full name */}
        <label className="block" style={{ marginBottom: '16px' }}>
          <span style={{
            display: 'block', color: NAVY, fontSize: '12px', fontWeight: 600,
            marginBottom: '6px', letterSpacing: '0.01em',
          }}>
            Full name
          </span>
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            autoFocus
            autoComplete="name"
            placeholder="Your full name"
            style={{
              width: '100%', height: '48px',
              background: FIELD_BG, border: `1px solid ${FIELD_BORD}`,
              borderRadius: '8px', padding: '0 14px',
              color: NAVY, fontSize: '14px', outline: 'none',
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = NAVY; e.currentTarget.style.boxShadow = `0 0 0 3px ${NAVY}1a`; }}
            onBlur={(e)  => { e.currentTarget.style.borderColor = FIELD_BORD; e.currentTarget.style.boxShadow = 'none'; }}
          />
        </label>

        {/* Password (with eye toggle, behavior unchanged) */}
        <label className="block" style={{ marginBottom: '6px' }}>
          <span style={{
            display: 'block', color: NAVY, fontSize: '12px', fontWeight: 600,
            marginBottom: '6px', letterSpacing: '0.01em',
          }}>
            Password
          </span>
          <div style={{ position: 'relative' }}>
            <input
              type={showPw ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              required
              style={{
                width: '100%', height: '48px',
                background: FIELD_BG, border: `1px solid ${FIELD_BORD}`,
                borderRadius: '8px', padding: '0 44px 0 14px',
                color: NAVY, fontSize: '14px', outline: 'none',
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
                position: 'absolute', right: '8px', top: '50%',
                transform: 'translateY(-50%)',
                height: '32px', width: '32px',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: '6px', color: MUTED, background: 'transparent',
                border: 'none', cursor: 'pointer',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#E1E7F2'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </label>
        <p style={{ color: MUTED, fontSize: '11px', margin: '0 0 22px 0' }}>
          At least 8 characters.
        </p>

        {/* Primary CTA — matches login button styling exactly */}
        <button
          type="submit"
          disabled={submitting}
          style={{
            width: '100%', height: '50px',
            background: submitting ? NAVY_DARK : NAVY,
            color: '#FFFFFF',
            fontSize: '15px', fontWeight: 700, letterSpacing: '0.02em',
            border: 'none', borderRadius: '8px',
            cursor: submitting ? 'not-allowed' : 'pointer',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
            transition: 'background 0.15s ease',
          }}
          onMouseEnter={(e) => { if (!submitting) e.currentTarget.style.background = NAVY_DARK; }}
          onMouseLeave={(e) => { if (!submitting) e.currentTarget.style.background = NAVY; }}
        >
          {submitting && <Spinner className="h-3 w-3" />}
          Accept Invitation
        </button>
      </form>

      {/* Small reassurance note about the auto-generated username */}
      <p style={{
        marginTop: '20px',
        paddingTop: '18px',
        borderTop: `1px solid ${FIELD_BORD}`,
        color: MUTED,
        fontSize: '11px',
        lineHeight: '17px',
        textAlign: 'center',
      }}>
        A username is generated for you automatically. You'll sign in with your
        email going forward — an admin can change your display username later
        if needed.
      </p>
    </BrandCard>
  );
}

// --------------------------------------------------------------------
function reasonTitle(r?: string) {
  switch (r) {
    case 'expired': return 'This invite has expired';
    case 'used':    return 'This invite was already used';
    case 'revoked': return 'This invite was revoked';
    case 'missing': return 'No invite token in the URL';
    default:        return 'Invite link not found';
  }
}
function reasonDescription(r?: string) {
  switch (r) {
    case 'expired': return 'The link has passed its expiry window.';
    case 'used':    return 'Each invite link can only be claimed once.';
    case 'revoked': return 'The admin who sent the link revoked it.';
    case 'missing': return 'The /invite URL needs a token.';
    default:        return 'We couldn\'t find a matching invite for that link.';
  }
}

/**
 * BrandCard — the EIA-branded shell shared by all three states
 * (loading / invalid / valid). Cream page background, white card with
 * the EIA wordmark + company name + italic tagline + gold divider at
 * the top, and the same italic footer line as the login page. Inner
 * children render below the gold divider, above the footer line.
 */
function BrandCard({ children }: { children: React.ReactNode }) {
  return (
    <div
      // Override the dark _bare layout's bg-app on this route only —
      // keeps the in-app dark theme intact.
      className="flex-1 flex items-center justify-center px-4 py-12 -m-px"
      style={{ background: CREAM, color: NAVY, minHeight: '100vh' }}
    >
      <div className="w-full" style={{ maxWidth: '440px' }}>
        <div
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
            <h1 style={{
              fontFamily: SERIF, fontWeight: 500, color: NAVY,
              fontSize: '56px', lineHeight: 1, letterSpacing: '0.08em', margin: 0,
            }}>
              EIA
            </h1>
            <p style={{
              fontFamily: SERIF, fontWeight: 500, color: NAVY,
              fontSize: '17px', letterSpacing: '0.02em',
              marginTop: '10px', marginBottom: 0,
            }}>
              Expert Intuitive Advisor Inc.
            </p>
            <p style={{
              fontStyle: 'italic', color: MUTED,
              fontSize: '11px', letterSpacing: '0.2em', textTransform: 'uppercase',
              marginTop: '14px', marginBottom: 0,
            }}>
              Internal Team Workspace
            </p>
            <div
              aria-hidden
              style={{
                width: '60px', height: '2px', background: GOLD,
                margin: '20px auto 0', borderRadius: '1px',
              }}
            />
          </div>

          {children}
        </div>

        {/* ----- Footer tagline ----- */}
        <p style={{
          textAlign: 'center', fontStyle: 'italic', color: MUTED,
          fontSize: '12px', marginTop: '28px', letterSpacing: '0.01em',
        }}>
          The intelligence layer between humans and AI.
        </p>
      </div>
    </div>
  );
}
