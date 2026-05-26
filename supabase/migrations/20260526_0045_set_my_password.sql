-- =====================================================================
-- 0045 — set_my_password(p_new_password) RPC.
--
-- Companion to migration 0044 (verify_current_password). The previous
-- attempt at fixing the Change-password form replaced the verify-step
-- signInWithPassword call with an RPC, but kept supabase.auth.updateUser
-- for the actual password write. That call wedges intermittently in the
-- browser with "Auth session missing!" — GoTrueClient's internal
-- _useSession() returns null even when the page is authenticated and
-- localStorage still has a valid session. The Node-side flow works
-- perfectly, so it's a browser-state issue inside the auth client.
--
-- This RPC fixes that class of bug for the WRITE side: it uses
-- auth.uid() (taken from the JWT in the Authorization header, NOT from
-- GoTrueClient state) and updates auth.users.encrypted_password via
-- pgcrypto crypt(). The session is untouched — no rotation, no auth
-- events, no race with the authStore listener — and the
-- "Auth session missing!" path is structurally impossible because we
-- never call GoTrueClient.
--
-- Security:
--   * SECURITY DEFINER. Granted to authenticated only.
--   * Only ever updates the CALLER'S OWN row (where id = auth.uid()).
--     Cannot be used as a back-door to change someone else's password.
--   * Length check (>= 8) mirrors the existing client-side check.
--   * The frontend continues to verify the user's CURRENT password via
--     0044's verify_current_password before calling this. The RPC
--     does NOT enforce that on its own — that's a UX decision the
--     caller owns.
--
-- Does NOT replace supabase.auth.updateUser for any other use; this is
-- scoped to the Change-password form only.
-- =====================================================================

create or replace function public.set_my_password(p_new_password text)
returns void
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_uid uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated' using errcode='42501';
  end if;
  if p_new_password is null or length(p_new_password) < 8 then
    raise exception 'Password must be at least 8 characters' using errcode='22023';
  end if;

  update auth.users
     set encrypted_password = extensions.crypt(p_new_password, extensions.gen_salt('bf')),
         updated_at         = now()
   where id = v_uid;
end;
$$;

revoke all on function public.set_my_password(text) from public;
grant execute on function public.set_my_password(text) to authenticated;

comment on function public.set_my_password(text) is
  '0045: set the CALLER''s own auth password via pgcrypto. Replaces supabase.auth.updateUser({password}) from the Change-password form, which throws "Auth session missing!" in the browser because GoTrueClient''s internal _useSession() can return null even when the page is authenticated. This RPC reads auth.uid() from the JWT, not from GoTrueClient state, so the wedge is impossible. Granted to authenticated only.';
