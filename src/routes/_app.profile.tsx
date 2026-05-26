import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { toast } from 'sonner';
import { Avatar } from '@/components/Avatar';
import { RoleBadge } from '@/components/RoleBadge';
import { Spinner } from '@/components/Spinner';
import { useAuthStore } from '@/state/authStore';
import { supabase } from '@/lib/supabase';

export const Route = createFileRoute('/_app/profile')({
  component: ProfilePage,
});

function ProfilePage() {
  const profile = useAuthStore((s) => s.profile);
  const refresh = useAuthStore((s) => s.refreshProfile);

  const [fullName, setFullName] = useState(profile?.full_name ?? '');
  const [title, setTitle] = useState(profile?.title ?? '');
  const [timezone, setTimezone] = useState(profile?.timezone ?? 'UTC');
  const [savingProfile, setSavingProfile] = useState(false);

  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [changingPw, setChangingPw] = useState(false);

  if (!profile) return null;

  const onSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    const { error } = await supabase
      .from('users')
      .update({ full_name: fullName, title, timezone } as never)
      .eq('id', profile.id);
    setSavingProfile(false);
    if (error) {
      toast.error('Could not save profile');
      return;
    }
    await refresh();
    toast.success('Profile saved');
  };

  const onChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPw.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }
    if (newPw !== confirmPw) {
      toast.error('Passwords do not match');
      return;
    }
    setChangingPw(true);
    try {
      // Step 1 — verify the CURRENT password via 0044's RPC. Session-free
      // (compares against auth.users.encrypted_password using pgcrypto).
      const { data: ok, error: verifyErr } = await supabase.rpc(
        'verify_current_password', { p_password: currentPw },
      );
      if (verifyErr) throw verifyErr;
      if (ok !== true) {
        toast.error('Current password is incorrect');
        return;
      }

      // Step 2 — write the new password via 0045's RPC. We deliberately
      // do NOT call supabase.auth.updateUser({ password }) here:
      //   * It internally calls GoTrueClient._useSession() which can
      //     return null even when the page is authenticated and
      //     localStorage holds a valid session — throwing
      //     "Auth session missing!" intermittently in the browser.
      //   * It rotates the session on success, which races the
      //     authStore's onAuthStateChange listener.
      // set_my_password reads auth.uid() from the JWT in the
      // Authorization header (NOT from GoTrueClient state), bypasses
      // both problems, and leaves the session/login untouched so the
      // admin stays signed in immediately after a successful change.
      const { error: setErr } = await supabase.rpc('set_my_password', {
        p_new_password: newPw,
      });
      if (setErr) {
        toast.error(setErr.message || 'Could not change password');
        return;
      }

      setCurrentPw(''); setNewPw(''); setConfirmPw('');
      toast.success('Password changed');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not change password');
    } finally {
      // ALWAYS clears the spinner — on success, on error, on anything
      // thrown above. Preserved from the prior fix.
      setChangingPw(false);
    }
  };

  return (
    <div className="px-8 py-6 max-w-[760px] mx-auto">
      <h1 className="text-3xl font-bold mb-6">My Profile</h1>

      {/* Identity card */}
      <section className="bg-surface border border-border-light rounded-md p-6 mb-6 flex items-center gap-4">
        <Avatar name={profile.full_name ?? profile.username} url={profile.avatar_url} size="xl" />
        <div className="min-w-0">
          <h2 className="text-xl font-semibold truncate">{profile.full_name ?? profile.username}</h2>
          <p className="text-sm text-text-secondary truncate">@{profile.username}</p>
          <div className="mt-2 flex items-center gap-2">
            <RoleBadge role={profile.role} />
            {profile.is_super_admin && (
              <span className="inline-flex items-center h-5 px-2 rounded-pill text-xs font-medium bg-label-pink/15 text-label-pink">
                Super Admin
              </span>
            )}
          </div>
        </div>
      </section>

      {/* Editable profile */}
      <form onSubmit={onSaveProfile} className="bg-surface border border-border-light rounded-md p-6 mb-6">
        <h2 className="text-lg font-semibold mb-4">Profile details</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* 0042: username is now system-managed (auto-generated on
              invite accept, renamable only by an admin). Shown here
              read-only so the user always knows what theirs is. */}
          <Field label="Username">
            <input
              className="input"
              value={`@${profile.username}`}
              disabled
              readOnly
              title="Username can be changed by an admin"
            />
          </Field>
          <Field label="Full name">
            <input
              className="input"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
            />
          </Field>
          <Field label="Title">
            <input
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
          <Field label="Timezone">
            <input
              className="input"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              placeholder="e.g. Asia/Karachi"
            />
          </Field>
          <Field label="Joined">
            <input
              className="input"
              value={new Date(profile.created_at).toLocaleDateString()}
              disabled
            />
          </Field>
          <Field label="Theme">
            <input className="input" value={profile.theme} disabled />
          </Field>
        </div>
        <div className="mt-4">
          <button
            type="submit"
            disabled={savingProfile}
            className="btn-primary"
          >
            {savingProfile && <Spinner className="h-3 w-3 mr-2" />}
            Save changes
          </button>
        </div>
      </form>

      {/* Change password */}
      <form onSubmit={onChangePassword} className="bg-surface border border-border-light rounded-md p-6">
        <h2 className="text-lg font-semibold mb-4">Change password</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Current password">
            <input type="password" className="input" value={currentPw} onChange={(e) => setCurrentPw(e.target.value)} required />
          </Field>
          <div />
          <Field label="New password">
            <input type="password" className="input" value={newPw} onChange={(e) => setNewPw(e.target.value)} required />
          </Field>
          <Field label="Confirm new password">
            <input type="password" className="input" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} required />
          </Field>
        </div>
        <div className="mt-4">
          <button
            type="submit"
            disabled={changingPw}
            className="btn-primary"
          >
            {changingPw && <Spinner className="h-3 w-3 mr-2" />}
            Change password
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wide text-text-secondary font-medium">{label}</span>
      {children}
    </label>
  );
}
