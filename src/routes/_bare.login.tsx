/**
 * /login — EIA Internal Projects sign-in page.
 *
 * High-fidelity recreation of the design handoff at
 *   C:/Users/astro/OneDrive/Desktop/PMS/design_handoff_login/{EIA Login.html, README.md}
 *
 * Two-column split (1.15fr brand / 1.0fr form), embedded product
 * preview window (board with two groups, status/priority chips,
 * summary strip), floating Super Intelligence orchestrator card and
 * Integrations card, trust badge row, AUP + Privacy modals, password
 * reveal toggle. All tokens, fonts (Inter + JetBrains Mono), and
 * animations are scoped to this route via inline styles + a single
 * <style> tag so the in-app dark theme stays on Geist + the existing
 * dark palette.
 *
 * Auth wiring is unchanged: the existing signInWithIdentifier hook
 * (username-or-email + password) is still the working path. SSO is
 * not configured for this app — the SSO button is rendered styled
 * but disabled with a "coming soon" tooltip per Q&A with the owner.
 * The legacy cream/serif EIA design has been replaced; this is now
 * the canonical /login.
 */
import { useEffect, useRef, useState } from 'react';
import { createFileRoute, useNavigate, redirect } from '@tanstack/react-router';
import { toast } from 'sonner';
import { useAuthStore } from '@/state/authStore';
import { Spinner } from '@/components/Spinner';
import { supabase } from '@/lib/supabase';
import { useIsMobileOrTablet } from '@/lib/deviceCheck';

interface LoginSearch { redirect?: string }

export const Route = createFileRoute('/_bare/login')({
  validateSearch: (search: Record<string, unknown>): LoginSearch => ({
    redirect: typeof search.redirect === 'string' ? search.redirect : undefined,
  }),
  beforeLoad: async ({ search }) => {
    const auth = useAuthStore.getState();
    if (auth.status === 'loading') await auth.initialize();
    const after = useAuthStore.getState();
    if (after.status === 'authenticated') {
      throw redirect({ to: (search.redirect as string) || '/' });
    }
  },
  component: LoginPage,
});

// =====================================================================
// Design tokens — scoped to this route only via inline styles so the
// rest of the app's dark theme is untouched. Sourced verbatim from
// the design handoff's :root block.
// =====================================================================
const T = {
  bgApp:        '#FAFAFB',
  bgCard:       '#FFFFFF',
  bgInput:      '#FFFFFF',
  bgSubtle:     '#F4F5F7',
  border:       '#E5E7EB',
  borderStrong: '#D1D5DB',
  textStrong:   '#0F172A',
  textBody:     '#1F2937',
  textMuted:    '#6B7280',
  textSubtle:   '#9CA3AF',
  brand:        '#1E3A8A',
  brandHover:   '#1E40AF',
  brandSoft:    '#EEF2FF',
  brandRing:    'rgba(30, 58, 138, 0.12)',
  success:      '#16A34A',
  successSoft:  'rgba(22, 163, 74, 0.12)',
  chipAmber:    'oklch(0.78 0.15 70)',
  chipCoral:    'oklch(0.72 0.16 25)',
  chipPink:     'oklch(0.68 0.18 350)',
  chipPurple:   'oklch(0.65 0.15 295)',
  chipSky:      'oklch(0.72 0.13 230)',
  chipTeal:     'oklch(0.62 0.10 200)',
  chipMint:     'oklch(0.75 0.14 160)',
  chipSlate:    'oklch(0.55 0.02 250)',
  shadowCard:   '0 1px 2px rgba(15, 23, 42, 0.04), 0 10px 30px rgba(15, 23, 42, 0.06)',
  shadowWindow: '0 1px 0 rgba(255,255,255,0.6) inset, 0 4px 12px rgba(15, 23, 42, 0.06), 0 30px 80px rgba(15, 23, 42, 0.18), 0 60px 160px rgba(30, 58, 138, 0.10)',
  fontSans:     "'Inter', system-ui, -apple-system, sans-serif",
  fontMono:     "'JetBrains Mono', ui-monospace, monospace",
};

// =====================================================================
// Route-scoped CSS — animations, responsive breakpoints, ambient
// background layers, modal backdrop blur. Keyed by a stable class
// (.login-page) on the outermost wrapper so nothing leaks.
// `prefers-reduced-motion` disables every infinite/scale animation
// per the README's a11y checklist.
// =====================================================================
const ROUTE_CSS = `
.login-page * { box-sizing: border-box; }
.login-page .stage {
  display: grid;
  grid-template-columns: 1.15fr 1fr;
  min-height: 100vh;
}
.login-page .info-panel {
  position: relative;
  background: #F7F8FB;
  padding: 32px 48px 28px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-right: 1px solid ${T.border};
}
.login-page .info-panel::before {
  content: ""; position: absolute; inset: 0;
  background:
    radial-gradient(ellipse 50% 40% at 78% 20%, rgba(101,143,255,0.18), transparent 60%),
    radial-gradient(ellipse 50% 40% at 18% 88%, rgba(45,212,191,0.10), transparent 60%),
    radial-gradient(ellipse 40% 35% at 88% 90%, rgba(231,84,128,0.07), transparent 60%);
  pointer-events: none; z-index: 0;
}
.login-page .info-panel::after {
  content: ""; position: absolute; inset: 0;
  background-image: radial-gradient(rgba(30,58,138,0.05) 1px, transparent 1.2px);
  background-size: 24px 24px;
  -webkit-mask-image: radial-gradient(ellipse 80% 70% at 50% 50%, black 30%, transparent 80%);
          mask-image: radial-gradient(ellipse 80% 70% at 50% 50%, black 30%, transparent 80%);
  opacity: 0.6; pointer-events: none; z-index: 0;
}
.login-page .pulse {
  animation: login-pulse 2.4s ease-in-out infinite;
}
.login-page .pulse-fast {
  animation: login-pulse-fast 1.6s ease-in-out infinite;
}
@keyframes login-pulse {
  0%, 100% { box-shadow: 0 0 0 3px ${T.successSoft}; }
  50%      { box-shadow: 0 0 0 6px rgba(22,163,74,0.04); }
}
@keyframes login-pulse-fast {
  0%, 100% { box-shadow: 0 0 0 3px rgba(245,166,35,0.20); }
  50%      { box-shadow: 0 0 0 6px rgba(245,166,35,0.04); }
}
.login-page .grad-text {
  background: linear-gradient(120deg, #2C4FB1 0%, #5E81F3 50%, #2A6D6B 100%);
  -webkit-background-clip: text; background-clip: text; color: transparent;
}
.login-page .input-base:focus {
  border-color: ${T.brand} !important;
  box-shadow: 0 0 0 3px ${T.brandRing} !important;
}
.login-page .input-base:hover { border-color: ${T.borderStrong}; }
.login-page .sso-btn:hover {
  background: ${T.bgSubtle};
  border-color: ${T.borderStrong};
  box-shadow: 0 1px 2px rgba(15,23,42,0.04);
}
.login-page .submit-btn:hover:not(:disabled) { background: ${T.brandHover}; }
.login-page .submit-btn:active:not(:disabled) { transform: translateY(1px); }
.login-page .reveal-btn:hover {
  color: ${T.textBody};
  background: ${T.bgSubtle};
}
.login-page .legal-link {
  color: ${T.textMuted}; text-decoration: none;
  border-bottom: 1px solid ${T.border};
  padding-bottom: 1px; cursor: pointer; background: none; border-top: none;
  border-left: none; border-right: none; font: inherit; padding-left: 0; padding-right: 0;
}
.login-page .legal-link:hover {
  color: ${T.textStrong};
  border-bottom-color: ${T.textMuted};
}
.login-page .modal-backdrop {
  position: fixed; inset: 0;
  background: rgba(15, 23, 42, 0.50);
  -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
  display: flex; align-items: center; justify-content: center;
  padding: 24px; z-index: 100; opacity: 0;
  animation: login-modal-fade 200ms ease forwards;
}
.login-page .modal-card {
  background: ${T.bgCard};
  border-radius: 14px;
  box-shadow: 0 30px 80px rgba(15,23,42,0.30);
  width: min(640px, 100%);
  max-height: min(820px, 92vh);
  display: flex; flex-direction: column; overflow: hidden;
  border: 1px solid ${T.border};
  transform: translateY(8px) scale(0.985);
  animation: login-modal-pop 220ms ease forwards;
}
@keyframes login-modal-fade { to { opacity: 1; } }
@keyframes login-modal-pop  { to { transform: translateY(0) scale(1); } }
@media (prefers-reduced-motion: reduce) {
  .login-page .pulse, .login-page .pulse-fast { animation: none !important; }
  .login-page .modal-backdrop, .login-page .modal-card { animation: none !important; transform: none !important; opacity: 1 !important; }
}
@media (max-width: 1100px) {
  .login-page .agent-card { right: -8px !important; bottom: -20px !important; }
  .login-page .integ-card { left: -8px !important; }
}
@media (max-width: 960px) {
  .login-page .stage { grid-template-columns: 1fr; }
  .login-page .info-panel { padding: 28px 28px 22px; border-right: none; border-bottom: 1px solid ${T.border}; }
  .login-page .form-panel { padding: 32px 24px 48px !important; }
  .login-page .hero       { padding: 24px 0 !important; }
  .login-page .preview    { margin-bottom: 36px !important; }
  .login-page .agent-card { right: 4px !important; bottom: -24px !important; }
  .login-page .integ-card { display: none !important; }
}
@media (max-width: 560px) {
  .login-page .info-panel { padding: 22px 18px 18px; }
  .login-page .form-panel { padding: 24px 16px 36px !important; }
  .login-page .form-card  { padding: 24px 22px 22px !important; }
  .login-page .agent-card { display: none !important; }
  .login-page .window     { transform: rotate(0deg) !important; }
}
@media (max-height: 800px) and (min-width: 961px) {
  .login-page .hero    { padding: 24px 0 16px !important; }
  .login-page .hero-sub{ margin-bottom: 20px !important; }
  .login-page .preview { margin-bottom: 18px !important; }
}
`;

function LoginPage() {
  const navigate = useNavigate();
  const { redirect: redirectTarget } = Route.useSearch();
  const signIn = useAuthStore((s) => s.signInWithIdentifier);

  // Phones and tablets (incl. iPadOS 13+ in desktop-Safari mode) can
  // BROWSE the login page, but cannot actually sign in. We let them
  // see the full page so the marketing/brand panel still reaches them,
  // then short-circuit onSubmit and reveal a red inline banner the
  // moment they hit "Sign in".
  const blockMobile = useIsMobileOrTablet();
  const [mobileBlockShown, setMobileBlockShown] = useState(false);

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword]   = useState('');
  const [remember, setRemember]   = useState(true);
  const [showPw, setShowPw]       = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [openModal, setOpenModal] = useState<'aup' | 'privacy' | null>(null);
  // Email-link modal — used for BOTH "Forgot password" (sends a
  // Supabase password-reset email) and the SSO sign-in option (sends
  // a magic-link). Same UI, different action.
  const [emailLink, setEmailLink] = useState<'reset' | 'magic' | null>(null);

  // Title for the tab — matches the design's <title>.
  useEffect(() => {
    const prev = document.title;
    document.title = 'EIA Internal Projects — Sign In';
    return () => { document.title = prev; };
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (blockMobile) {
      // Reveal the inline red banner (sticky for the rest of the
      // session) and toast at the same time, then bail without any
      // network call so credentials are never sent.
      setMobileBlockShown(true);
      toast.error('Please sign in from a computer, laptop, or desktop device.');
      return;
    }
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

  return (
    <div
      className="login-page"
      // Override the dark _bare layout's bg-app on this route only —
      // keeps the in-app dark theme intact.
      style={{
        background: T.bgApp,
        color: T.textBody,
        fontFamily: T.fontSans,
        fontSize: '14px',
        WebkitFontSmoothing: 'antialiased',
        minHeight: '100vh',
        margin: '-1px',
      }}
    >
      <style>{ROUTE_CSS}</style>
      <div className="stage">
        <BrandPanel onOpenModal={setOpenModal} />
        <FormPanel
          identifier={identifier} setIdentifier={setIdentifier}
          password={password}     setPassword={setPassword}
          remember={remember}     setRemember={setRemember}
          showPw={showPw}         setShowPw={setShowPw}
          submitting={submitting}
          onSubmit={onSubmit}
          onOpenModal={setOpenModal}
          onOpenEmailLink={setEmailLink}
          mobileBlockShown={mobileBlockShown}
        />
      </div>

      {openModal === 'aup'     && <AupModal     onClose={() => setOpenModal(null)} />}
      {openModal === 'privacy' && <PrivacyModal onClose={() => setOpenModal(null)} />}
      {emailLink && (
        <EmailLinkModal
          mode={emailLink}
          onClose={() => setEmailLink(null)}
          blockMobile={blockMobile}
        />
      )}
    </div>
  );
}

// =====================================================================
// MobileBlockBanner — small red inline banner shown inside the sign-in
// card the moment a phone/tablet visitor actually clicks "Sign in".
// We DON'T pre-empt the page — they can browse the whole login page;
// the block only appears at the sign-in attempt. Red palette per the
// explicit product requirement.
// =====================================================================
function MobileBlockBanner({ context = 'sign in' }: { context?: 'sign in' | 'send sign-in link' }) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      style={{
        display: 'flex', alignItems: 'flex-start', gap: '10px',
        padding: '12px 14px', marginBottom: '18px',
        background: '#FEF2F2', border: '1px solid #FECACA',
        borderLeft: '4px solid #DC2626', borderRadius: '8px',
      }}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
           stroke="#DC2626" strokeWidth="1.8"
           strokeLinecap="round" strokeLinejoin="round" aria-hidden
           style={{ flexShrink: 0, marginTop: '1px' }}>
        <rect x="2" y="4" width="20" height="13" rx="2" />
        <path d="M8 21h8M12 17v4" />
      </svg>
      <div style={{ minWidth: 0 }}>
        <p style={{
          margin: 0, color: '#DC2626', fontSize: '13px', fontWeight: 600,
          lineHeight: 1.35, letterSpacing: '-0.005em',
        }}>
          Cannot {context} from this device.
        </p>
        <p style={{
          margin: '4px 0 0', color: '#DC2626', fontSize: '12.5px',
          fontWeight: 500, lineHeight: 1.45,
        }}>
          Please sign in from a <strong style={{ fontWeight: 700 }}>computer, laptop, or desktop</strong> device.
          Phones and tablets (including iPad) are not supported.
        </p>
      </div>
    </div>
  );
}

// =====================================================================
// Brand panel (left) — TopCrest + Hero + ProductPreview + TrustRow
// =====================================================================
function BrandPanel({ onOpenModal }: { onOpenModal: (m: 'aup' | 'privacy') => void }) {
  return (
    <aside className="info-panel">
      {/* TopCrest */}
      <div style={{ position: 'relative', zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '12px' }}>
          <span style={{
            width: '32px', height: '32px', borderRadius: '8px',
            background: T.brand, color: '#fff',
            display: 'grid', placeItems: 'center',
            fontWeight: 700, fontSize: '14px',
            boxShadow: '0 1px 0 rgba(255,255,255,0.12) inset, 0 1px 2px rgba(15,23,42,0.1)',
          }}>E</span>
          <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15 }}>
            <span style={{ fontSize: '14px', fontWeight: 600, color: T.textStrong, letterSpacing: '-0.005em' }}>
              Expert Intuitive Advisor Inc.
            </span>
            <span style={{ fontSize: '11px', color: T.textMuted, fontWeight: 500 }}>EIA Internal Projects</span>
          </span>
        </div>
        <span title="Verified workspace" style={{
          display: 'inline-flex', alignItems: 'center', gap: '6px',
          padding: '5px 10px', borderRadius: '999px',
          background: '#fff', border: `1px solid ${T.border}`,
          fontSize: '11px', color: T.textMuted, fontWeight: 500,
          fontFamily: T.fontMono, letterSpacing: '0.04em',
        }}>
          <span className="pulse" style={{
            width: '6px', height: '6px', borderRadius: '50%',
            background: T.success,
            boxShadow: `0 0 0 3px ${T.successSoft}`,
          }} />
          <span>Verified workspace</span>
        </span>
      </div>

      {/* Hero */}
      <div className="hero" style={{
        position: 'relative', zIndex: 2, flex: 1,
        display: 'flex', flexDirection: 'column', justifyContent: 'center',
        padding: '36px 0 24px',
      }}>
        <p style={{
          fontFamily: T.fontMono, fontSize: '11px', fontWeight: 500,
          letterSpacing: '0.18em', textTransform: 'uppercase',
          color: T.brand, margin: '0 0 14px',
          display: 'inline-flex', alignItems: 'center', gap: '10px',
        }}>
          <span style={{ display: 'inline-block', width: '24px', height: '1px', background: T.brand, transform: 'translateY(-3px)' }} />
          Internal Projects · v3.4
        </p>
        <h1 style={{
          fontFamily: T.fontSans, fontWeight: 600,
          fontSize: 'clamp(28px, 2.9vw, 38px)', lineHeight: 1.12,
          color: T.textStrong, margin: '0 0 12px',
          letterSpacing: '-0.022em', maxWidth: '18ch',
        }}>
          Where work, <span className="grad-text">agents,</span> and <span className="grad-text">intelligence</span> meet.
        </h1>
        <p className="hero-sub" style={{
          fontSize: '14.5px', color: T.textMuted, lineHeight: 1.55,
          margin: '0 0 28px', maxWidth: '44ch',
        }}>
          One workspace for every team. AI agents plan and execute. Integrations bring every tool inline. Automation keeps the rhythm. You stay focused on the work that matters.
        </p>

        <ProductPreview />
      </div>

      {/* TrustRow */}
      <div style={{
        position: 'relative', zIndex: 2, marginTop: 'auto', paddingTop: '20px',
        borderTop: `1px solid ${T.border}`,
        display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px 18px',
      }}>
        {[
          { label: 'SOC 2 Type II', d: 'M12 2 4 6v6c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V6l-8-4z M9 12l2 2 4-4' },
          { label: 'AES-256 encryption', d: 'M4 11h16v10H4zM8 11V8a4 4 0 0 1 8 0v3' },
          { label: 'SSO & MFA', d: 'M12 22s-8-4-8-12V5l8-3 8 3v5c0 8-8 12-8 12z' },
          { label: 'GDPR compliant', d: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM2.5 12h19M12 2.5a14.5 14.5 0 0 1 0 19M12 2.5a14.5 14.5 0 0 0 0 19' },
        ].map((b) => (
          <span key={b.label} style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            fontSize: '11.5px', color: T.textMuted,
            fontWeight: 500, fontFamily: T.fontMono, letterSpacing: '0.02em',
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={T.textSubtle} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d={b.d} />
            </svg>
            <span>{b.label}</span>
          </span>
        ))}
      </div>

      <div style={{
        position: 'relative', zIndex: 2, marginTop: '18px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        fontSize: '11px', color: T.textSubtle, fontFamily: T.fontMono, letterSpacing: '0.02em',
      }}>
        <span>© 2026 Expert Intuitive Advisor Inc.</span>
        <span>
          <button type="button" className="legal-link" onClick={() => onOpenModal('privacy')}>Privacy</button>
          &nbsp;·&nbsp;
          <button type="button" className="legal-link" onClick={() => onOpenModal('aup')}>Acceptable Use</button>
        </span>
      </div>
    </aside>
  );
}

// =====================================================================
// ProductPreview — the embedded board mock + floating cards
// =====================================================================
function ProductPreview() {
  return (
    <div className="preview" style={{ position: 'relative', margin: '4px 0 24px', perspective: '1600px' }} aria-hidden>
      {/* Integrations card (floating top-left) */}
      <div className="integ-card" style={{
        position: 'absolute', left: '-22px', top: '-16px',
        background: '#fff', border: `1px solid ${T.border}`,
        borderRadius: '12px',
        boxShadow: '0 1px 2px rgba(15,23,42,0.06), 0 12px 30px rgba(15,23,42,0.10)',
        padding: '12px 14px', zIndex: 3,
        transform: 'rotate(-2deg)',
      }}>
        <p style={{
          fontFamily: T.fontMono, fontSize: '9.5px', color: T.textMuted,
          letterSpacing: '0.10em', textTransform: 'uppercase', margin: '0 0 8px',
        }}>Integrations · 34</p>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          {[
            { l: 'S', bg: '#4A154B' },
            { l: 'G', bg: '#181717' },
            { l: 'N', bg: '#000000' },
            { l: 'D', bg: '#1A73E8' },
            { l: 'F', bg: '#0084FF' },
          ].map((i) => (
            <span key={i.l} style={{
              width: '24px', height: '24px', borderRadius: '6px',
              display: 'grid', placeItems: 'center',
              color: '#fff', fontWeight: 700, fontSize: '10px',
              fontFamily: T.fontMono, letterSpacing: '-0.02em',
              background: i.bg,
            }}>{i.l}</span>
          ))}
        </div>
      </div>

      {/* Window */}
      <div className="window" style={{
        position: 'relative', background: '#0F1117',
        borderRadius: '12px', overflow: 'hidden',
        boxShadow: T.shadowWindow,
        transform: 'rotate(-1.2deg)', transformOrigin: '30% 50%',
      }}>
        {/* Chrome */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          padding: '10px 14px', background: '#181B22',
          borderBottom: '1px solid rgba(255,255,255,0.04)',
        }}>
          <span style={{ display: 'inline-flex', gap: '6px' }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#FF6058' }} />
            <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#FFBD2E' }} />
            <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#28C840' }} />
          </span>
          <span style={{
            marginLeft: '10px', fontFamily: T.fontMono,
            fontSize: '10px', color: 'rgba(255,255,255,0.45)', letterSpacing: '0.04em',
          }}>projects.expertintuitiveadvisor.com</span>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: '2px', padding: '8px 12px 0', background: '#181B22', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
          {[
            { name: 'Main',     active: true },
            { name: 'Kanban',   active: false },
            { name: 'Calendar', active: false },
            { name: '+',        active: false },
          ].map((t) => (
            <span key={t.name} style={{
              padding: '6px 8px 8px', fontSize: '9.5px', fontWeight: 500,
              color: t.active ? '#fff' : 'rgba(255,255,255,0.45)',
              borderBottom: `2px solid ${t.active ? T.chipSky : 'transparent'}`,
              display: 'inline-flex', alignItems: 'center', gap: '4px',
            }}>{t.name}</span>
          ))}
        </div>

        {/* Toolbar */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '6px',
          padding: '8px 12px', background: '#181B22',
          borderBottom: '1px solid rgba(255,255,255,0.04)',
          fontSize: '9px', color: 'rgba(255,255,255,0.55)',
        }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: '3px',
            padding: '3px 7px', borderRadius: '5px',
            background: 'oklch(0.55 0.12 230)', color: '#fff', fontWeight: 600,
          }}>+ New task</span>
          {['⌕ Search', '☰ Filter', '⇋ Sort', '⧬ Group'].map((b) => (
            <span key={b} style={{
              display: 'inline-flex', alignItems: 'center', gap: '3px',
              padding: '3px 7px', borderRadius: '5px', color: 'rgba(255,255,255,0.7)',
            }}>{b}</span>
          ))}
          <span style={{ flex: 1 }} />
          <span style={{ padding: '3px 7px', borderRadius: '5px', color: 'rgba(255,255,255,0.7)' }}>⋯</span>
        </div>

        {/* Group A — Team Red Projects (pink spine) */}
        <BoardGroup
          spine={T.chipPink}
          title="Team Red Projects"
          taskCount={7}
          rows={[
            { name: 'Scrape Shopify catalog',     chk: true,  avLabel: 'AR', avBg: T.chipPurple, code: 'T-01', status: { label: 'Working',    color: T.chipAmber  }, type: { label: 'AI Co-Work',  color: 'oklch(0.45 0.08 200)' }, time: { label: '2–3h',   color: 'oklch(0.62 0.15 40)' }, prio: { label: 'High',   color: T.chipPurple } },
            { name: 'Brief: weekly digest — Q2',  chk: false, avLabel: 'EM', avBg: T.chipTeal,   code: 'T-04', status: { label: 'Not Started', color: T.chipSlate  }, type: { label: 'By Human',    color: T.chipPurple                          }, time: { label: '60–90m', color: 'oklch(0.68 0.14 55)' }, prio: { label: 'Medium', color: T.chipSky    } },
            { name: 'Sync Slack threads → board', chk: true,  avLabel: 'JK', avBg: T.chipAmber,  code: 'T-07', status: { label: 'In Review',   color: T.chipPurple }, type: { label: 'Human & AI',  color: T.chipTeal                            }, time: { label: '5–10m',  color: 'oklch(0.74 0.13 70)', darkText: true }, prio: { label: 'High',   color: T.chipPurple } },
            { name: 'Onboard Axel — week plan',   chk: false, avLabel: 'RS', avBg: T.chipPink,   code: 'T-09', status: { label: 'Done',        color: T.chipMint, darkText: true }, type: { label: 'AI Co-Work', color: 'oklch(0.45 0.08 200)' }, time: { label: '2–3h',   color: 'oklch(0.55 0.16 25)' }, prio: { label: 'Low',    color: T.chipSlate  } },
            { name: 'QA: vendor data drift',      chk: false, avLabel: 'LP', avBg: T.chipMint,   code: 'T-11', status: { label: 'On Hold',     color: T.chipCoral  }, type: { label: 'AI Co-Work',  color: 'oklch(0.45 0.08 200)' }, time: { label: '60–90m', color: 'oklch(0.68 0.14 55)' }, prio: { label: 'Medium', color: T.chipSky    } },
            { name: 'Notion sync — product wiki', chk: false, avLabel: 'DK', avBg: T.chipSky,    code: 'T-12', status: { label: 'Working',    color: T.chipAmber  }, type: { label: 'Human & AI',  color: T.chipTeal                            }, time: { label: '2–3h',   color: 'oklch(0.62 0.15 40)' }, prio: { label: 'High',   color: T.chipPurple } },
          ]}
          summaryBars={{
            status: [{ w: '34%', c: T.chipAmber }, { w: '18%', c: T.chipSlate }, { w: '14%', c: T.chipPurple }, { w: '14%', c: T.chipCoral }, { w: '20%', c: T.chipMint }],
            type:   [{ w: '46%', c: 'oklch(0.45 0.08 200)' }, { w: '20%', c: T.chipPurple }, { w: '34%', c: T.chipTeal }],
            time:   [{ w: '18%', c: 'oklch(0.74 0.13 70)' }, { w: '34%', c: 'oklch(0.68 0.14 55)' }, { w: '32%', c: 'oklch(0.62 0.15 40)' }, { w: '16%', c: 'oklch(0.55 0.16 25)' }],
            prio:   [{ w: '46%', c: T.chipPurple }, { w: '34%', c: T.chipSky }, { w: '20%', c: T.chipSlate }],
          }}
        />

        {/* Group B — Task for Axel Rose (mint spine) */}
        <BoardGroup
          spine={T.chipMint}
          title="Task for Axel Rose"
          taskCount={4}
          rows={[
            { name: 'Plan Q3 OKRs — review with VPE',  chk: true,  avLabel: 'AR', avBg: T.chipPurple, code: 'A-01', status: { label: 'Working',    color: T.chipAmber  }, type: { label: 'By Human',    color: T.chipPurple                          }, time: { label: '2–3h',  color: 'oklch(0.62 0.15 40)' }, prio: { label: 'High',   color: T.chipPurple } },
            { name: 'Approve agent permission scope',  chk: false, avLabel: 'AR', avBg: T.chipPurple, code: 'A-02', status: { label: 'In Review',  color: T.chipPurple }, type: { label: 'Human & AI',  color: T.chipTeal                            }, time: { label: '5–10m', color: 'oklch(0.74 0.13 70)', darkText: true }, prio: { label: 'Medium', color: T.chipSky    } },
            { name: 'Calendar block: deep work, Tue',  chk: false, avLabel: 'AR', avBg: T.chipPurple, code: 'A-03', status: { label: 'Not Started', color: T.chipSlate }, type: { label: 'AI Co-Work',  color: 'oklch(0.45 0.08 200)'                }, time: { label: '2–3h',  color: 'oklch(0.55 0.16 25)' }, prio: { label: 'High',   color: T.chipPurple } },
          ]}
          // No summary strip on the smaller group per the design (it shows on Group A only above the new group block).
          summaryBars={null}
          extraStyle={{ paddingTop: '2px' }}
        />
      </div>

      {/* Super Intelligence card (floating bottom-right) */}
      <SuperIntelligenceCard />
    </div>
  );
}

// ----- Single group block inside the board preview ------------------
type ChipSpec = { label: string; color: string; darkText?: boolean };
interface BoardRow {
  name: string; chk: boolean;
  avLabel: string; avBg: string;
  code: string;
  status: ChipSpec; type: ChipSpec; time: ChipSpec; prio: ChipSpec;
}
interface SummaryBars {
  status: { w: string; c: string }[];
  type:   { w: string; c: string }[];
  time:   { w: string; c: string }[];
  prio:   { w: string; c: string }[];
}
function BoardGroup({ spine, title, taskCount, rows, summaryBars, extraStyle }: {
  spine: string; title: string; taskCount: number;
  rows: BoardRow[]; summaryBars: SummaryBars | null;
  extraStyle?: React.CSSProperties;
}) {
  const gridCols = '2.2fr 0.55fr 0.7fr 1fr 1.1fr 1fr 0.8fr';
  return (
    <div style={{ padding: '10px 12px 4px', ...extraStyle }}>
      {/* Group title */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
        <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '8px' }}>▾</span>
        <span style={{ width: '4px', height: '12px', borderRadius: '1px', background: spine }} />
        <h3 style={{ fontSize: '11px', fontWeight: 600, margin: 0, letterSpacing: '-0.005em', color: spine }}>{title}</h3>
        <span style={{
          fontFamily: T.fontMono, fontSize: '9px',
          color: 'rgba(255,255,255,0.4)',
          background: 'rgba(255,255,255,0.04)',
          padding: '1px 6px', borderRadius: '999px',
        }}>{taskCount} tasks</span>
      </div>

      {/* Header band */}
      <div style={{
        display: 'grid', gridTemplateColumns: gridCols, gap: '1px',
        background: '#3A4250',
        borderRadius: '3px 3px 0 0', overflow: 'hidden',
        borderLeft: `3px solid ${spine}`,
      }}>
        {['Task', 'Owner', 'Code', 'Status', 'Task Type', 'Co-Work Time', 'Priority'].map((h) => (
          <div key={h} style={{
            background: '#3A4250', padding: '5px 7px',
            fontSize: '9px', fontWeight: 500,
            color: 'rgba(255,255,255,0.85)', letterSpacing: '0.01em',
          }}>{h}</div>
        ))}
      </div>

      {/* Rows */}
      {rows.map((r, i) => (
        <div key={i} style={{
          display: 'grid', gridTemplateColumns: gridCols, gap: '1px',
          marginTop: '1px', borderLeft: `3px solid ${spine}`,
        }}>
          <Cell name>
            <span style={{
              width: '8px', height: '8px', borderRadius: '2px',
              flexShrink: 0,
              background: r.chk ? T.chipSky : 'transparent',
              border: `1px solid ${r.chk ? T.chipSky : 'rgba(255,255,255,0.25)'}`,
            }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
          </Cell>
          <Cell owner>
            <span style={{
              width: '15px', height: '15px', borderRadius: '50%',
              display: 'grid', placeItems: 'center',
              color: r.avLabel === 'JK' || r.avLabel === 'LP' ? '#1a1a1a' : '#fff',
              fontSize: '7.5px', fontWeight: 700,
              fontFamily: T.fontMono,
              boxShadow: '0 0 0 1.5px #2B2F36',
              background: r.avBg,
            }}>{r.avLabel}</span>
          </Cell>
          <Cell code>{r.code}</Cell>
          <Chip {...r.status} />
          <Chip {...r.type} />
          <Chip {...r.time} />
          <Chip {...r.prio} />
        </div>
      ))}

      {/* Summary strip */}
      {summaryBars && (
        <div style={{
          display: 'grid', gridTemplateColumns: gridCols, gap: '1px',
          marginTop: '1px', height: '12px', marginBottom: '8px',
          borderLeft: `3px solid ${spine}`,
        }}>
          <div style={{ background: '#2B2F36', height: '100%' }} />
          <div style={{ background: '#2B2F36', height: '100%' }} />
          <div style={{ background: '#2B2F36', height: '100%' }} />
          <SummaryBars bars={summaryBars.status} />
          <SummaryBars bars={summaryBars.type} />
          <SummaryBars bars={summaryBars.time} />
          <SummaryBars bars={summaryBars.prio} />
        </div>
      )}
    </div>
  );
}

function Cell({ children, name, owner, code }: { children: React.ReactNode; name?: boolean; owner?: boolean; code?: boolean }) {
  return (
    <div style={{
      padding: '5px 7px',
      fontSize: name ? '9.5px' : code ? '8.5px' : '9.5px',
      color: name ? '#E8EAEC' : code ? 'rgba(255,255,255,0.7)' : '#fff',
      background: '#2B2F36',
      display: 'flex', alignItems: 'center',
      justifyContent: owner || code ? 'center' : 'flex-start',
      gap: name ? '5px' : 0,
      fontWeight: name ? 400 : 500,
      letterSpacing: '-0.005em',
      minHeight: '22px',
      fontFamily: code ? T.fontMono : undefined,
    }}>{children}</div>
  );
}
function Chip({ label, color, darkText }: ChipSpec) {
  return (
    <div style={{
      padding: '5px 7px', fontSize: '9.5px',
      color: darkText ? '#1a1a1a' : '#fff',
      background: color,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontWeight: 500, letterSpacing: '-0.005em', minHeight: '22px',
    }}>{label}</div>
  );
}
function SummaryBars({ bars }: { bars: { w: string; c: string }[] }) {
  return (
    <div style={{ background: '#2B2F36', height: '100%', display: 'flex' }}>
      {bars.map((b, i) => (
        <span key={i} style={{ width: b.w, background: b.c, height: '100%', display: 'block' }} />
      ))}
    </div>
  );
}

// =====================================================================
// SuperIntelligenceCard — floating bottom-right of the window
// =====================================================================
function SuperIntelligenceCard() {
  return (
    <div className="agent-card" aria-hidden style={{
      position: 'absolute', right: '-36px', bottom: '-52px',
      background: 'linear-gradient(180deg, #fff, #FAFBFE)',
      border: `1px solid ${T.border}`, borderRadius: '14px',
      boxShadow: '0 1px 2px rgba(15,23,42,0.06), 0 16px 40px rgba(15,23,42,0.14), 0 30px 80px rgba(30,58,138,0.10)',
      padding: '14px 16px 12px', width: '290px', zIndex: 3,
      transform: 'rotate(1.5deg)',
    }}>
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: '6px',
        padding: '3px 8px', borderRadius: '999px',
        background: `linear-gradient(135deg, ${T.chipPurple}, ${T.chipTeal})`,
        color: '#fff', fontFamily: T.fontMono, fontSize: '9px',
        fontWeight: 600, letterSpacing: '0.10em', textTransform: 'uppercase',
        marginBottom: '10px',
      }}>
        <span style={{
          width: '5px', height: '5px', borderRadius: '50%', background: '#fff',
          boxShadow: '0 0 0 2px rgba(255,255,255,0.40)',
        }} />
        Super Intelligence · Orchestrator
      </span>

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
        <span style={{
          width: '26px', height: '26px', borderRadius: '7px',
          background: `linear-gradient(135deg, ${T.chipPurple}, ${T.chipTeal})`,
          display: 'grid', placeItems: 'center', color: '#fff',
          boxShadow: '0 4px 10px rgba(124, 90, 200, 0.28)',
        }}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </span>
        <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15 }}>
          <span style={{ fontSize: '11.5px', fontWeight: 600, color: T.textStrong, letterSpacing: '-0.005em' }}>Planner Agent</span>
          <span style={{ fontFamily: T.fontMono, fontSize: '9px', color: T.textMuted, letterSpacing: '0.04em' }}>12 agents · 4 active now</span>
        </span>
        <span style={{ marginLeft: 'auto', width: '28px', height: '28px', position: 'relative' }} title="Plan progress 68%">
          <svg width="28" height="28" viewBox="0 0 28 28" style={{ transform: 'rotate(-90deg)' }}>
            <circle cx="14" cy="14" r="11" stroke="#E5E7EB" strokeWidth="3" fill="none" />
            <circle cx="14" cy="14" r="11" stroke="url(#g-meter)" strokeWidth="3" fill="none" strokeDasharray="69.1 24.0" strokeLinecap="round" />
            <defs>
              <linearGradient id="g-meter" x1="0" y1="0" x2="28" y2="28" gradientUnits="userSpaceOnUse">
                <stop offset="0" stopColor="#9b5fe0" />
                <stop offset="1" stopColor="#2a6d6b" />
              </linearGradient>
            </defs>
          </svg>
          <span style={{
            position: 'absolute', inset: 0, display: 'grid', placeItems: 'center',
            fontFamily: T.fontMono, fontSize: '8px', fontWeight: 700, color: T.textStrong,
          }}>68</span>
        </span>
      </div>

      <p style={{
        position: 'relative', fontSize: '11px', color: T.textBody, lineHeight: 1.4,
        margin: '8px 0', padding: '8px 28px 8px 10px',
        background: T.bgSubtle, border: `1px solid ${T.border}`, borderRadius: '8px',
      }}>
        <em style={{ fontStyle: 'italic', color: T.textMuted }}>
          “Plan Axel's full week — 4 deep-work blocks + 2 reviews, all AI Co-Work. Avoid Mondays.”
        </em>
        <span style={{
          position: 'absolute', right: '6px', top: '6px',
          fontFamily: T.fontMono, fontSize: '9px', color: T.textSubtle,
          background: '#fff', border: `1px solid ${T.border}`,
          padding: '1px 4px', borderRadius: '4px', lineHeight: 1,
        }}>⌫</span>
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', margin: '0 0 10px' }}>
        <Step state="ok"    label="Read 126 active tasks"        num="+126" />
        <Step state="ok"    label="Scan calendar for free blocks" num="14 found" />
        <Step state="run"   label="Draft week plan · routing to 3 agents" num="running" />
        <Step state="queue" label="Apply changes — awaits review" />
      </div>

      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', paddingTop: '8px', borderTop: `1px solid ${T.border}` }}>
        {[
          { t: '+ 6 tasks', accent: true },
          { t: 'Mon–Fri' },
          { t: '8h / day' },
          { t: '3 integrations' },
        ].map((tag) => (
          <span key={tag.t} style={{
            fontFamily: T.fontMono, fontSize: '9px',
            background: tag.accent ? T.brandSoft : T.bgSubtle,
            color:      tag.accent ? T.brand      : T.textBody,
            padding: '3px 7px', borderRadius: '999px',
            border: `1px solid ${tag.accent ? 'rgba(30,58,138,0.18)' : T.border}`,
          }}>{tag.t}</span>
        ))}
      </div>
    </div>
  );
}
function Step({ state, label, num }: { state: 'ok' | 'run' | 'queue'; label: string; num?: string }) {
  const dotColor = state === 'ok' ? T.success : state === 'run' ? T.chipAmber : T.textSubtle;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10.5px', color: T.textBody }}>
      <span className={state === 'run' ? 'pulse-fast' : undefined} style={{
        width: '5px', height: '5px', borderRadius: '50%',
        flexShrink: 0, background: dotColor,
      }} />
      <span style={{
        color: state === 'ok' ? T.textMuted : T.textBody,
        textDecoration: state === 'ok' ? 'line-through' : 'none',
      }}>{label}</span>
      {num && <span style={{ marginLeft: 'auto', fontFamily: T.fontMono, fontSize: '9px', color: T.textSubtle }}>{num}</span>}
    </div>
  );
}

// =====================================================================
// Form panel (right) — the actual sign-in card
// =====================================================================
interface FormProps {
  identifier: string; setIdentifier: (s: string) => void;
  password:   string; setPassword:   (s: string) => void;
  remember:   boolean; setRemember:  (b: boolean) => void;
  showPw:     boolean; setShowPw:    (b: boolean) => void;
  submitting: boolean;
  onSubmit:   (e: React.FormEvent) => void;
  onOpenModal: (m: 'aup' | 'privacy') => void;
  onOpenEmailLink: (m: 'reset' | 'magic') => void;
  mobileBlockShown: boolean;
}
function FormPanel({
  identifier, setIdentifier, password, setPassword,
  remember, setRemember, showPw, setShowPw,
  submitting, onSubmit, onOpenModal, onOpenEmailLink,
  mobileBlockShown,
}: FormProps) {
  return (
    <section className="form-panel" style={{
      background: T.bgApp,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '48px 32px',
    }}>
      <div className="form-card" style={{
        width: '100%', maxWidth: '400px',
        background: T.bgCard, border: `1px solid ${T.border}`,
        borderRadius: '14px', padding: '36px 36px 28px',
        boxShadow: T.shadowCard,
      }}>
        <header style={{ marginBottom: '26px', textAlign: 'left' }}>
          <h2 style={{
            fontFamily: T.fontSans, fontWeight: 600, fontSize: '22px',
            color: T.textStrong, margin: '0 0 6px', letterSpacing: '-0.015em',
          }}>Sign in to your account</h2>
          <p style={{ fontSize: '13.5px', color: T.textMuted, margin: 0, lineHeight: 1.5 }}>
            Use your corporate credentials to continue.
          </p>
        </header>

        {/* Mobile/tablet sign-in block — shown only AFTER the user
            attempts to sign in on a phone or iPad. They can browse
            the page freely; only the sign-in attempt is rejected. */}
        {mobileBlockShown && <MobileBlockBanner />}

        {/* SSO button — opens the email-link modal in 'magic' mode.
            We email a one-time sign-in link to the user (passwordless).
            Works for any user with a real email on their auth record. */}
        <button
          type="button"
          className="sso-btn"
          onClick={() => onOpenEmailLink('magic')}
          style={{
            width: '100%', height: '44px',
            background: T.bgCard, border: `1px solid ${T.border}`,
            borderRadius: '8px', color: T.textStrong,
            fontFamily: T.fontSans, fontSize: '14px', fontWeight: 500,
            cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ color: T.textMuted }} aria-hidden>
            <rect x="4" y="11" width="16" height="10" rx="2" />
            <path d="M8 11V8a4 4 0 0 1 8 0v3" />
          </svg>
          <span>Continue with Single Sign-On</span>
        </button>

        <div style={{
          margin: '18px 0', display: 'flex', alignItems: 'center', gap: '12px',
          color: T.textSubtle, fontSize: '11px', fontWeight: 500,
          fontFamily: T.fontMono, letterSpacing: '0.10em', textTransform: 'uppercase',
        }}>
          <span style={{ flex: 1, height: '1px', background: T.border }} />
          or sign in with email
          <span style={{ flex: 1, height: '1px', background: T.border }} />
        </div>

        <form onSubmit={onSubmit} autoComplete="on" noValidate>
          {/* Identifier */}
          <div style={{ marginBottom: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', margin: '0 0 6px' }}>
              <label htmlFor="login-id" style={{ fontSize: '12.5px', fontWeight: 500, color: T.textBody }}>
                Work email or username
              </label>
            </div>
            <input
              id="login-id"
              type="text"
              autoComplete="username"
              placeholder="you@expert.com"
              required
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              className="input-base"
              autoFocus
              style={{
                width: '100%', height: '42px', padding: '0 12px',
                background: T.bgInput, border: `1px solid ${T.border}`,
                borderRadius: '8px', color: T.textStrong,
                fontFamily: T.fontSans, fontSize: '14px', fontWeight: 400,
                outline: 'none',
              }}
            />
          </div>

          {/* Password */}
          <div style={{ marginBottom: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', margin: '0 0 6px' }}>
              <label htmlFor="login-pw" style={{ fontSize: '12.5px', fontWeight: 500, color: T.textBody }}>Password</label>
              <a
                href="#"
                onClick={(e) => { e.preventDefault(); onOpenEmailLink('reset'); }}
                style={{ fontSize: '12.5px', color: T.brand, textDecoration: 'none', fontWeight: 500 }}
              >Forgot?</a>
            </div>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <input
                id="login-pw"
                type={showPw ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="Enter your password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input-base"
                style={{
                  width: '100%', height: '42px', padding: '0 40px 0 12px',
                  background: T.bgInput, border: `1px solid ${T.border}`,
                  borderRadius: '8px', color: T.textStrong,
                  fontFamily: T.fontSans, fontSize: '14px', fontWeight: 400,
                  outline: 'none',
                }}
              />
              <button
                type="button"
                className="reveal-btn"
                onClick={() => setShowPw(!showPw)}
                aria-label={showPw ? 'Hide password' : 'Show password'}
                style={{
                  position: 'absolute', right: '4px',
                  width: '34px', height: '34px',
                  display: 'grid', placeItems: 'center',
                  background: 'transparent', border: 'none',
                  color: T.textSubtle, cursor: 'pointer', borderRadius: '6px',
                }}
              >
                {showPw ? (
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 2l20 20" />
                    <path d="M6.7 6.7C3.9 8.6 2 12 2 12s3.5 7 10 7c1.9 0 3.6-.5 5-1.2" />
                    <path d="M9.6 5.2A10.6 10.6 0 0 1 12 5c6.5 0 10 7 10 7-.6 1.1-1.6 2.4-2.8 3.5" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {/* Remember */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '4px 0 22px' }}>
            <label style={{
              display: 'inline-flex', alignItems: 'center', gap: '8px',
              fontSize: '12.5px', color: T.textBody, cursor: 'pointer', userSelect: 'none',
            }}>
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} style={{ display: 'none' }} />
              <span style={{
                width: '16px', height: '16px', borderRadius: '4px',
                border: `1.5px solid ${remember ? T.brand : T.borderStrong}`,
                background: remember ? T.brand : T.bgCard,
                display: 'grid', placeItems: 'center', transition: 'all 160ms',
              }}>
                <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: remember ? 1 : 0, transition: 'opacity 120ms' }}>
                  <path d="m5 12 5 5L20 7" />
                </svg>
              </span>
              <span>Keep me signed in</span>
            </label>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={submitting}
            className="submit-btn"
            style={{
              position: 'relative', width: '100%', height: '44px',
              border: 'none', borderRadius: '8px',
              background: T.brand, color: '#FFFFFF',
              fontFamily: T.fontSans, fontSize: '14px', fontWeight: 600,
              letterSpacing: '-0.005em', cursor: submitting ? 'wait' : 'pointer',
              transition: 'background 160ms ease, transform 100ms ease',
              boxShadow: '0 1px 0 rgba(255,255,255,0.10) inset, 0 1px 2px rgba(15,23,42,0.12)',
              opacity: submitting ? 0.92 : 1,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
            }}
          >
            {submitting && <Spinner className="h-3 w-3" />}
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>

          <p style={{
            marginTop: '18px', textAlign: 'center',
            fontSize: '11.5px', color: T.textSubtle, lineHeight: 1.55,
          }}>
            By signing in you agree to the{' '}
            <button type="button" className="legal-link" onClick={() => onOpenModal('aup')}>Acceptable Use Policy</button>
            {' '}and{' '}
            <button type="button" className="legal-link" onClick={() => onOpenModal('privacy')}>Privacy Notice</button>.
          </p>
        </form>
      </div>
    </section>
  );
}

// =====================================================================
// Modal shell + AUP + Privacy contents
// =====================================================================
function Modal({
  title, eyebrow, onClose, children,
}: {
  title: string; eyebrow: string; onClose: () => void; children: React.ReactNode;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    setTimeout(() => closeRef.current?.focus(), 50);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="login-modal-title"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="modal-card">
        <header style={{
          padding: '22px 28px 18px', borderBottom: `1px solid ${T.border}`,
          background: T.bgCard, display: 'flex', alignItems: 'flex-start',
          justifyContent: 'space-between', gap: '24px',
        }}>
          <div>
            <p style={{
              fontFamily: T.fontMono, fontSize: '11px', fontWeight: 500,
              letterSpacing: '0.18em', textTransform: 'uppercase',
              color: T.textMuted, margin: '0 0 6px',
            }}>{eyebrow}</p>
            <h2 id="login-modal-title" style={{
              fontFamily: T.fontSans, fontWeight: 600, fontSize: '22px',
              color: T.textStrong, margin: 0, letterSpacing: '-0.015em', lineHeight: 1.2,
            }}>{title}</h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              flexShrink: 0, width: '34px', height: '34px', borderRadius: '8px',
              border: `1px solid ${T.border}`, background: T.bgCard,
              color: T.textMuted, cursor: 'pointer',
              display: 'grid', placeItems: 'center',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = T.bgSubtle; e.currentTarget.style.color = T.textStrong; e.currentTarget.style.borderColor = T.borderStrong; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = T.bgCard;  e.currentTarget.style.color = T.textMuted; e.currentTarget.style.borderColor = T.border; }}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </header>

        <div style={{
          padding: '22px 28px 28px', overflowY: 'auto',
          color: T.textBody, fontSize: '13.5px', lineHeight: 1.65,
        }}>
          {children}
        </div>

        <footer style={{
          padding: '14px 28px', borderTop: `1px solid ${T.border}`,
          background: T.bgSubtle,
          display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '10px',
        }}>
          <button type="button" onClick={onClose} style={{
            height: '38px', padding: '0 16px', borderRadius: '8px',
            background: 'transparent', border: `1px solid ${T.border}`,
            color: T.textBody, fontFamily: T.fontSans, fontSize: '13px', fontWeight: 500, cursor: 'pointer',
          }}>Close</button>
          <button type="button" onClick={onClose} style={{
            height: '38px', padding: '0 18px', borderRadius: '8px',
            background: T.brand, border: 'none', color: '#fff',
            fontFamily: T.fontSans, fontSize: '13px', fontWeight: 600, cursor: 'pointer',
          }}>I understand</button>
        </footer>
      </div>
    </div>
  );
}

function H3({ num, children }: { num: number; children: React.ReactNode }) {
  return (
    <h3 style={{
      fontFamily: T.fontSans, fontWeight: 600, fontSize: '14px',
      color: T.textStrong, margin: '22px 0 8px', letterSpacing: '-0.005em',
      display: 'flex', alignItems: 'center', gap: '10px',
    }}>
      <span style={{
        display: 'inline-grid', placeItems: 'center',
        width: '22px', height: '22px', borderRadius: '6px',
        background: T.textStrong, color: '#fff',
        fontSize: '11px', fontWeight: 700, fontVariantNumeric: 'tabular-nums',
      }}>{num}</span>
      {children}
    </h3>
  );
}
const Lede = ({ children }: { children: React.ReactNode }) => (
  <p style={{
    fontSize: '14px', color: T.textBody, margin: '0 0 22px',
    padding: '14px 16px', background: T.bgSubtle,
    border: `1px solid ${T.border}`, borderRadius: '10px', lineHeight: 1.55,
  }}>{children}</p>
);
const Meta = ({ left, right }: { left: string; right: string }) => (
  <div style={{
    marginTop: '24px', paddingTop: '16px', borderTop: `1px solid ${T.border}`,
    fontFamily: T.fontMono, fontSize: '11px', color: T.textSubtle, letterSpacing: '0.04em',
    display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px',
  }}>
    <span>{left}</span>
    <span>{right}</span>
  </div>
);

// =====================================================================
// EmailLinkModal — one modal serving two flows:
//   mode='reset'  → password reset (Supabase sends a recovery email
//                   whose link lands on /reset-password where the
//                   user picks a new password).
//   mode='magic'  → magic-link sign-in (Supabase sends a one-time
//                   link whose click signs the user in directly).
//
// Input accepts EITHER an email OR a username — same UX as the
// sign-in form. Username gets resolved to its email via the
// existing resolve_login_email RPC (migration 0041).
//
// Success is always toasted GENERICALLY ("If an account exists for
// that email, a link has been sent.") so an attacker can't probe
// which usernames/emails are valid.
// =====================================================================
function EmailLinkModal({ mode, onClose, blockMobile }: {
  mode: 'reset' | 'magic';
  onClose: () => void;
  blockMobile: boolean;
}) {
  const [identifier, setIdentifier] = useState('');
  const [sending, setSending]       = useState(false);
  // Mirror the login form: phones/iPads can OPEN this modal and see
  // it; they just can't successfully request a magic sign-in link
  // (which would otherwise let them log in by clicking the email).
  // Password-reset is fine — it just sets a new password.
  const [showMobileBlock, setShowMobileBlock] = useState(false);

  const title    = mode === 'reset' ? 'Reset your password' : 'Sign in with email link';
  const eyebrow  = mode === 'reset' ? 'Password reset'      : 'Single sign-on';
  const intro    = mode === 'reset'
    ? "Enter your email or username and we'll send you a link to reset your password."
    : "Enter your email or username and we'll email you a one-time sign-in link.";
  const button   = mode === 'reset' ? 'Send reset link' : 'Send sign-in link';

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Block the magic-link sign-in path on phones/iPads — same rule
    // as the password form. Reset-password is not a sign-in, so we
    // let that one through even on mobile.
    if (mode === 'magic' && blockMobile) {
      setShowMobileBlock(true);
      toast.error('Please sign in from a computer, laptop, or desktop device.');
      return;
    }
    const raw = identifier.trim();
    if (!raw) { toast.error('Enter your email or username'); return; }

    setSending(true);
    try {
      // Resolve username → email if needed (same path the sign-in
      // form uses). For an email-shaped value this returns it back.
      let email = raw.toLowerCase();
      if (!email.includes('@')) {
        const { data, error } = await supabase.rpc('resolve_login_email', { p_identifier: raw });
        if (!error && typeof data === 'string') email = data;
        // If resolve returns null we still call the auth method with
        // the raw value — Supabase will return its own generic
        // "User not found" path and we collapse both into the same
        // toast below so the user can't enumerate accounts.
      }

      if (mode === 'reset') {
        await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin + '/reset-password',
        });
      } else {
        await supabase.auth.signInWithOtp({
          email,
          options: { emailRedirectTo: window.location.origin + '/' },
        });
      }

      // GENERIC success — never confirm whether the account exists.
      toast.success(
        mode === 'reset'
          ? 'If an account exists for that email, a reset link has been sent. Check your inbox.'
          : 'If an account exists for that email, a sign-in link has been sent. Check your inbox.',
      );
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not send the link');
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal title={title} eyebrow={eyebrow} onClose={onClose}>
      {showMobileBlock && <MobileBlockBanner context="send sign-in link" />}
      <p style={{ fontSize: '14px', color: T.textBody, margin: '0 0 18px', lineHeight: 1.55 }}>
        {intro}
      </p>
      <form onSubmit={onSubmit}>
        <label htmlFor="el-id" style={{ display: 'block', fontSize: '12.5px', fontWeight: 500, color: T.textBody, marginBottom: '6px' }}>
          Work email or username
        </label>
        <input
          id="el-id"
          type="text"
          autoComplete="username"
          autoFocus
          placeholder="you@expert.com"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          className="input-base"
          style={{
            width: '100%', height: '42px', padding: '0 12px',
            background: T.bgInput, border: `1px solid ${T.border}`,
            borderRadius: '8px', color: T.textStrong,
            fontFamily: T.fontSans, fontSize: '14px', outline: 'none',
          }}
        />
        <div style={{
          marginTop: '20px',
          display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '10px',
        }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              height: '38px', padding: '0 16px', borderRadius: '8px',
              background: 'transparent', border: `1px solid ${T.border}`,
              color: T.textBody, fontFamily: T.fontSans, fontSize: '13px', fontWeight: 500,
              cursor: 'pointer',
            }}
          >Cancel</button>
          <button
            type="submit"
            disabled={sending}
            className="submit-btn"
            style={{
              height: '38px', padding: '0 18px', borderRadius: '8px',
              background: T.brand, border: 'none', color: '#fff',
              fontFamily: T.fontSans, fontSize: '13px', fontWeight: 600,
              cursor: sending ? 'wait' : 'pointer',
              opacity: sending ? 0.92 : 1,
              display: 'inline-flex', alignItems: 'center', gap: '8px',
            }}
          >
            {sending && <Spinner className="h-3 w-3" />}
            {sending ? 'Sending…' : button}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function AupModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Acceptable Use Policy" eyebrow="Policy" onClose={onClose}>
      <Lede>
        This Acceptable Use Policy applies to everyone who accesses EIA Internal Projects (“the Platform”) operated by <strong style={{ color: T.textStrong }}>Expert Intuitive Advisor Inc.</strong> By signing in, you agree to use the Platform in accordance with the terms below.
      </Lede>

      <H3 num={1}>Authorized Use</H3>
      <p>The Platform is provided for the legitimate business purposes of Expert Intuitive Advisor and its authorized personnel and partners. You may use the Platform only with credentials issued to you, and only for tasks within the scope of your role and responsibilities.</p>

      <H3 num={2}>Prohibited Activities</H3>
      <p>You agree <strong style={{ color: T.textStrong }}>not</strong> to use the Platform to:</p>
      <ul style={{ margin: '6px 0 12px', paddingLeft: '18px' }}>
        <li>Access, share, or attempt to access accounts, data, or systems you are not authorized to use.</li>
        <li>Upload, store, or transmit unlawful, defamatory, harassing, infringing, or malicious content.</li>
        <li>Introduce viruses, malware, or any code designed to harm or disrupt the Platform or its users.</li>
        <li>Interfere with, probe, scan, or test the vulnerability of the Platform without explicit written authorization.</li>
        <li>Circumvent authentication, rate limits, or any access controls.</li>
        <li>Use automated systems (bots, scrapers, crawlers) other than through documented APIs and within published limits.</li>
        <li>Resell, sublicense, or commercially exploit access to the Platform or its data.</li>
      </ul>

      <H3 num={3}>Account Security</H3>
      <ul style={{ margin: '6px 0 12px', paddingLeft: '18px' }}>
        <li>Keep your credentials confidential. You are responsible for all activity under your account.</li>
        <li>Use a strong, unique password and enable multi-factor authentication when available.</li>
        <li>Notify <a href="mailto:security@expertintuitiveadvisor.com" style={{ color: T.brand, textDecoration: 'none', borderBottom: `1px solid ${T.border}` }}>security@expertintuitiveadvisor.com</a> immediately if you suspect unauthorized access.</li>
      </ul>

      <H3 num={4}>Confidential Information</H3>
      <p>Content within the Platform — including project plans, tasks, comments, attachments, AI agent outputs, and customer data — may be confidential. You agree to handle such content in accordance with your employment or contractor agreement and applicable law, and you will not export, copy, or share confidential information outside authorized channels.</p>

      <H3 num={5}>AI Agents &amp; Automation</H3>
      <p>When you interact with AI agents on the Platform, prompts and outputs may be processed by Expert Intuitive Advisor and selected sub-processors. Do not submit sensitive personal information, customer PII, or material non-public information into AI prompts unless your role and the applicable workspace policy expressly permit it.</p>

      <H3 num={6}>Monitoring &amp; Enforcement</H3>
      <p>Expert Intuitive Advisor may monitor, log, and audit Platform activity for security, compliance, and operational purposes. We reserve the right to investigate suspected violations and may suspend or terminate access, with or without notice, for any conduct that we believe in good faith violates this policy or applicable law.</p>

      <H3 num={7}>Changes</H3>
      <p>This policy may be updated from time to time. Material changes will be communicated through the Platform or via the contact details associated with your account. Continued use after a change constitutes acceptance.</p>

      <Meta left="Effective · 27 May 2026" right="EIA-LEGAL-AUP · v1.0" />
    </Modal>
  );
}

function PrivacyModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Privacy Notice" eyebrow="Notice" onClose={onClose}>
      <Lede>
        This notice explains how <strong style={{ color: T.textStrong }}>Expert Intuitive Advisor Inc.</strong> collects, uses, and protects information when you use EIA Internal Projects. It applies to employees, contractors, and authorized partners.
      </Lede>

      <H3 num={1}>Information We Collect</H3>
      <ul style={{ margin: '6px 0 12px', paddingLeft: '18px' }}>
        <li><strong style={{ color: T.textStrong }}>Account information</strong> — name, work email, role, team, profile photo, and authentication identifiers.</li>
        <li><strong style={{ color: T.textStrong }}>Work content</strong> — projects, boards, tasks, files, comments, statuses, and AI agent prompts and outputs you create or upload.</li>
        <li><strong style={{ color: T.textStrong }}>Usage data</strong> — device, browser, IP address, pages viewed, actions taken, timestamps, and performance metrics.</li>
        <li><strong style={{ color: T.textStrong }}>Security logs</strong> — sign-in attempts, session activity, and audit events used to protect the Platform.</li>
      </ul>

      <H3 num={2}>How We Use Information</H3>
      <ul style={{ margin: '6px 0 12px', paddingLeft: '18px' }}>
        <li>Provide, secure, and improve the Platform and the features you use.</li>
        <li>Authenticate users and prevent unauthorized access or abuse.</li>
        <li>Operate AI assistance — routing prompts to authorized models and surfacing outputs back to you.</li>
        <li>Generate aggregated, de-identified usage statistics for product decisions.</li>
        <li>Meet legal, audit, and compliance obligations applicable to Expert Intuitive Advisor.</li>
      </ul>

      <H3 num={3}>Legal Bases</H3>
      <p>Where required, we process personal data on the basis of (a) the contract between Expert Intuitive Advisor and your employer or you, (b) our legitimate interests in operating and securing the Platform, (c) compliance with legal obligations, and (d) your consent where it has been requested.</p>

      <H3 num={4}>Sharing</H3>
      <p>We share information only with:</p>
      <ul style={{ margin: '6px 0 12px', paddingLeft: '18px' }}>
        <li>Authorized members of your workspace, as configured by your administrators.</li>
        <li>Trusted sub-processors that provide hosting, observability, security, analytics, and AI inference under contractual safeguards.</li>
        <li>Authorities, when required by valid legal process or to protect the Platform and its users.</li>
      </ul>
      <p>We do not sell personal information.</p>

      <H3 num={5}>AI Processing</H3>
      <p>Content submitted to AI features is processed to generate the requested output. Prompts and outputs may be retained for security review and product improvement. We do not use customer content to train third-party foundation models without explicit authorization.</p>

      <H3 num={6}>Retention</H3>
      <p>We retain information for as long as your account remains active and for a reasonable period thereafter to meet legal, security, and operational requirements. Workspace administrators control the retention of project content.</p>

      <H3 num={7}>Security</H3>
      <p>We employ technical and organizational measures including encryption in transit and at rest, access controls, vulnerability management, and continuous monitoring. Report concerns to <a href="mailto:security@expertintuitiveadvisor.com" style={{ color: T.brand, textDecoration: 'none', borderBottom: `1px solid ${T.border}` }}>security@expertintuitiveadvisor.com</a>.</p>

      <H3 num={8}>Your Rights</H3>
      <p>Subject to applicable law, you may have rights to access, correct, delete, or restrict the use of your personal information, and to data portability. Submit requests through your administrator or to <a href="mailto:privacy@expertintuitiveadvisor.com" style={{ color: T.brand, textDecoration: 'none', borderBottom: `1px solid ${T.border}` }}>privacy@expertintuitiveadvisor.com</a>.</p>

      <H3 num={9}>Contact</H3>
      <p>Expert Intuitive Advisor Inc. — Privacy Office.<br />Email: <a href="mailto:privacy@expertintuitiveadvisor.com" style={{ color: T.brand, textDecoration: 'none', borderBottom: `1px solid ${T.border}` }}>privacy@expertintuitiveadvisor.com</a></p>

      <Meta left="Effective · 27 May 2026" right="EIA-LEGAL-PRIVACY · v1.0" />
    </Modal>
  );
}
