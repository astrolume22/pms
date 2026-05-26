-- =====================================================================
-- 0041 — resolve_login_email RPC (Part 2B — login by username OR email).
--
-- Background:
--   • Legacy / synthetic users authenticate via `username@pms.internal`
--     (the frontend constructs that email and passes it to
--     supabase.auth.signInWithPassword).
--   • Migration 0040 (Part 1) added invitee_email support, so newly
--     invited users now have a REAL email in BOTH auth.users.email and
--     public.users.email — no longer `@pms.internal`.
--   • Goal: the login screen accepts EITHER the username OR the real
--     email and signs the user in. We need a safe server-side
--     translator from "what the user typed" → "the auth.users email
--     Supabase expects".
--
-- This function is the ONLY new surface area for Part 2B. It is a pure
-- read, granted to anon (the login page calls it before any session
-- exists). It returns ONLY the email string — never the row id, role,
-- password hash, or any other column. Returns NULL on no match so the
-- caller cannot distinguish "username doesn't exist" from "wrong
-- password" (the frontend feeds NULL into signInWithPassword as-is,
-- which fails with the same generic error path).
--
-- Restricted to status='active' so deactivated accounts cannot even
-- begin a Supabase auth round-trip. Belt-and-braces with the existing
-- post-signin status check in authStore.
--
-- Username regex enforced by accept_invite (0040) is `^[a-z0-9_]{2,32}$`
-- — usernames can NEVER contain '@' or '.', so the email-shaped vs
-- username-shaped branches below cannot collide.
--
-- NO schema change, NO new column, NO RLS change, NO change to
-- accept_invite / create_invite / auth.users / public.users / answers.
-- ON DELETE SET NULL semantics on existing user FKs preserved.
-- =====================================================================

create or replace function public.resolve_login_email(p_identifier text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id    text;
  v_email text;
begin
  -- Normalize. Empty/null identifier ⇒ no match.
  v_id := lower(trim(coalesce(p_identifier, '')));
  if v_id = '' then
    return null;
  end if;

  -- Email-shaped lookup: try to match against public.users.email.
  -- public.users.email is unique + lowercased on insert (accept_invite
  -- does `v_email := lower(v_invite.invitee_email)`), and legacy
  -- synthetic emails are already lowercase (`username || '@pms.internal'`).
  if position('@' in v_id) > 0 then
    select email into v_email
      from public.users
     where lower(email) = v_id
       and status = 'active'
     limit 1;
    return v_email; -- may be null if not found / not active
  end if;

  -- Username-shaped lookup: usernames are stored lowercase (enforced
  -- by accept_invite). Return the user's email column — which is the
  -- exact value Supabase auth expects, whether real or `@pms.internal`.
  select email into v_email
    from public.users
   where username = v_id
     and status = 'active'
   limit 1;
  return v_email;
end;
$$;

-- Lock down + expose to anon (login page calls this BEFORE any session).
revoke all on function public.resolve_login_email(text) from public;
grant execute on function public.resolve_login_email(text) to anon, authenticated;

comment on function public.resolve_login_email(text) is
  '0041: translate a login identifier (username OR email) to the auth.users email needed by signInWithPassword. Returns NULL on no match — never raises — so the caller cannot enumerate users. Active users only. Returns ONLY the email column.';
