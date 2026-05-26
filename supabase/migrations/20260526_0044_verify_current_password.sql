-- =====================================================================
-- 0044 — verify_current_password(p_password) RPC.
--
-- Background: the Change-password form used supabase.auth.signInWithPassword
-- as a "verify the current password before updating" check. On a user that
-- is ALREADY signed in, that call rotates the session and fires SIGNED_IN
-- on the authStore listener, which re-fetches the profile through the
-- SAME supabase client. The combination wedges the awaited promise
-- intermittently and leaves the UI spinner stuck (sometimes after the
-- subsequent updateUser PUT has silently rotated the password on the
-- server). See _app.profile.tsx for the failing call site.
--
-- This RPC removes the need to ever call signInWithPassword from that
-- flow: it takes a plaintext password and compares it against the
-- caller's own auth.users.encrypted_password using pgcrypto's crypt().
-- Returns boolean. The session is untouched, no events fire, no race.
--
-- SECURITY DEFINER, granted to authenticated only. The function only
-- ever reads the CALLER's own row (where id = auth.uid()), so it
-- cannot be turned into an oracle for someone else's password.
-- =====================================================================

create or replace function public.verify_current_password(p_password text)
returns boolean
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_uid uuid;
  v_ok  boolean;
begin
  v_uid := auth.uid();
  if v_uid is null then
    return false;
  end if;
  if p_password is null or length(p_password) = 0 then
    return false;
  end if;

  -- Match the stored bcrypt hash. crypt(p_password, stored) returns
  -- the same hash iff p_password is correct. Compare hash-equal.
  select (encrypted_password = extensions.crypt(p_password, encrypted_password))
    into v_ok
    from auth.users
   where id = v_uid;

  return coalesce(v_ok, false);
end;
$$;

revoke all on function public.verify_current_password(text) from public;
grant execute on function public.verify_current_password(text) to authenticated;

comment on function public.verify_current_password(text) is
  '0044: verify the CALLER''s own current password against auth.users.encrypted_password via pgcrypto crypt(). Returns boolean. Used by the Change-password form to replace supabase.auth.signInWithPassword (which rotated the session and caused the form to hang).';
