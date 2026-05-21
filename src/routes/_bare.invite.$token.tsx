/**
 * Public route — recipient of an invite link lands here without an
 * account. We validate the token via the anon-safe RPC
 * `get_invite_by_token`, then let them claim it by picking a username
 * + password. On success we sign them in and bounce to the app (or
 * directly into the inviting board, if board-specific).
 */
import { useEffect, useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import {
  CheckCircle2, AlertTriangle, Eye, EyeOff, ShieldCheck, KeyRound,
} from 'lucide-react';
import { useInviteByToken, useAcceptInvite } from '@/hooks/invites';
import { useAuthStore } from '@/state/authStore';
import { RoleBadge } from '@/components/RoleBadge';
import { Spinner } from '@/components/Spinner';

export const Route = createFileRoute('/_bare/invite/$token')({
  component: InvitePage,
});

function InvitePage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const signIn = useAuthStore((s) => s.signInWithUsername);

  const { data: check, isLoading } = useInviteByToken(token);
  const accept = useAcceptInvite();

  const [username, setUsername] = useState('');
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
    const u = username.trim().toLowerCase();
    if (!/^[a-z0-9_]{2,32}$/.test(u)) {
      toast.error('Username must be 2-32 lowercase letters / digits / underscore');
      return;
    }
    if (password.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }
    setSubmitting(true);
    try {
      const result = await accept.mutateAsync({
        token, username: u, fullName: fullName.trim() || u, password,
      });
      // The accept_invite RPC ran as anon — now sign in with the new credentials.
      await signIn(u, password, true);
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
      <CenteredCard>
        <div className="flex flex-col items-center gap-3 py-6">
          <Spinner className="h-7 w-7 text-brand" />
          <p className="text-sm text-text-secondary">Checking invite link…</p>
        </div>
      </CenteredCard>
    );
  }

  // ---------- Invalid ----------
  if (!check?.valid) {
    return (
      <CenteredCard>
        <div className="flex flex-col items-center text-center gap-3 py-2">
          <AlertTriangle className="h-10 w-10 text-warning" />
          <h2 className="text-xl font-semibold">{reasonTitle(check?.reason)}</h2>
          <p className="text-sm text-text-secondary max-w-[320px]">
            {reasonDescription(check?.reason)} Ask the admin who shared the link
            to generate a fresh one.
          </p>
          <button
            type="button"
            onClick={() => navigate({ to: '/login' })}
            className="btn-ghost mt-2"
          >
            Go to sign in
          </button>
        </div>
      </CenteredCard>
    );
  }

  // ---------- Already authed redirect happens in useEffect ----------

  // ---------- Valid: accept form ----------
  return (
    <CenteredCard>
      <div className="text-center mb-5">
        <h1 className="text-2xl font-bold">You're invited to PMS</h1>
        <div className="mt-2 flex items-center justify-center gap-2 text-sm text-text-secondary">
          <span>You'll join as</span>
          {check.role && <RoleBadge role={check.role} />}
          {check.board_name && (
            <>
              <span>·</span>
              <span className="font-medium text-text-primary truncate max-w-[180px]">{check.board_name}</span>
            </>
          )}
        </div>
      </div>

      <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
        <Field label="Username" hint="2-32 lowercase letters / digits / underscore — internal only">
          <input
            type="text"
            className="input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            required
          />
        </Field>
        <Field label="Full name">
          <input
            type="text"
            className="input"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Optional — defaults to username"
          />
        </Field>
        <Field label="Password" hint="At least 8 characters">
          <div className="relative">
            <input
              type={showPw ? 'text' : 'password'}
              className="input pr-10 font-mono"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              required
            />
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setShowPw((v) => !v)}
              aria-label={showPw ? 'Hide password' : 'Show password'}
              className="absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7 inline-flex items-center justify-center rounded-base text-text-secondary hover:bg-hover"
            >
              {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </Field>

        <button
          type="submit"
          disabled={submitting}
          className="btn-primary w-full inline-flex items-center justify-center gap-2"
        >
          {submitting && <Spinner className="h-3 w-3" />}
          <CheckCircle2 className="h-4 w-4" />
          Claim invite and sign in
        </button>
      </form>

      <div className="mt-5 pt-5 border-t border-border-light text-[11px] text-text-secondary flex items-start gap-2">
        <ShieldCheck className="h-3.5 w-3.5 text-success shrink-0 mt-0.5" />
        <span>
          PMS is invitation-only. Your account is internal — only your username
          is shared on the platform; no emails are stored or shown.
        </span>
      </div>
    </CenteredCard>
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

function CenteredCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-[440px]">
        <div className="text-center mb-6">
          <h1 className="text-3xl font-bold tracking-wide inline-flex items-center gap-2">
            <KeyRound className="h-7 w-7 text-brand" />
            PMS
          </h1>
        </div>
        <div className="bg-surface border border-border-light rounded-md shadow-md p-8">
          {children}
        </div>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs uppercase tracking-wide text-text-secondary font-medium mb-1">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-text-secondary mt-1">{hint}</span>}
    </label>
  );
}
