-- =====================================================================
-- 0054 — PMS new-device / new-location login alert (ADDITIVE ONLY).
--
-- Adds TWO new tables + ONE helper function. It does NOT:
--   • alter any auth.* table (the function only READS auth.users +
--     auth.audit_log_entries — never writes there),
--   • change RLS on any existing table,
--   • touch the teamblue rotation reminder (teamblue_rotation_log,
--     teamblue_last_login, /api/check-teamblue-login) — separate stream,
--   • touch invite/reset flows, existing crons, answers, or any data.
--
-- Purpose: standard, disclosed "new sign-in detected" fraud-prevention
-- control. On a successful PMS login by any account EXCEPT teamblue, if
-- the device OR location is new/unrecognized for that account,
-- /api/check-login-devices emails the company-owned security mailbox
-- (info@sondryn.com). Routine logins from a known device+location send
-- nothing.
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- known_logins — the per-account allowlist of recognized
-- (device_fingerprint, location) pairs. A login matching an existing row
-- is "recognized" (just bump last_seen, no email). A miss is new.
-- ---------------------------------------------------------------------
create table if not exists public.known_logins (
  id                 uuid primary key default gen_random_uuid(),
  account_email      text not null,
  device_fingerprint text,
  location           text,
  first_seen         timestamptz not null default now(),
  last_seen          timestamptz not null default now()
);

-- Index on the match key. UNIQUE so the same (account, device, location)
-- can't be stored twice (and concurrent cron ticks can't race-insert
-- duplicates) — same columns the spec asked to index, with a correctness
-- guarantee added.
create unique index if not exists known_logins_match_key
  on public.known_logins (account_email, device_fingerprint, location);

alter table public.known_logins enable row level security;
-- Service-role only (the cron). Admins may READ for transparency.
drop policy if exists known_logins_select_admin on public.known_logins;
create policy known_logins_select_admin
  on public.known_logins for select to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------
-- login_alert_log — one row per new-device/location ALERT (dedupe ledger
-- so one event = one email).
-- ---------------------------------------------------------------------
create table if not exists public.login_alert_log (
  id                 uuid primary key default gen_random_uuid(),
  user_email         text not null,
  role               text,
  login_at           timestamptz not null,
  login_ip           text,
  login_location     text,
  device_fingerprint text,
  alerted_at         timestamptz,
  created_at         timestamptz not null default now()
);

-- Dedupe key: one alert per (account, login timestamp, device). Prevents
-- a repeat email for the same new-device event even across overlapping
-- cron runs.
create unique index if not exists login_alert_log_event_key
  on public.login_alert_log (user_email, login_at, device_fingerprint);

alter table public.login_alert_log enable row level security;
drop policy if exists login_alert_log_select_admin on public.login_alert_log;
create policy login_alert_log_select_admin
  on public.login_alert_log for select to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------
-- recent_logins_except_teamblue() — READ-ONLY peek at the auth schema.
-- For every auth user that has ever signed in, EXCEPT teamblue, returns
-- email, role (from public.users), last_sign_in_at, the IP + user-agent
-- from their most recent audit entry. SECURITY DEFINER so it can read
-- auth.*; it only SELECTs and NEVER writes to / alters any auth table.
-- Execute restricted to the service role (the cron).
--
-- teamblue is excluded by BOTH id and email so the teamblue reminder
-- stream stays distinct.
-- ---------------------------------------------------------------------
create or replace function public.recent_logins_except_teamblue()
returns table (
  user_id    uuid,
  email      text,
  role       text,
  login_at   timestamptz,
  login_ip   text,
  user_agent text
)
language sql
stable
security definer
set search_path = public, auth
as $$
  select
    u.id as user_id,
    u.email::text as email,
    pu.role::text as role,
    u.last_sign_in_at as login_at,
    (
      select a.ip_address::text
      from auth.audit_log_entries a
      where (a.payload->>'actor_id') = u.id::text
        and a.ip_address is not null
        and a.ip_address <> ''
      order by a.created_at desc
      limit 1
    ) as login_ip,
    (
      select a.payload->>'user_agent'
      from auth.audit_log_entries a
      where (a.payload->>'actor_id') = u.id::text
        and (a.payload->>'user_agent') is not null
      order by a.created_at desc
      limit 1
    ) as user_agent
  from auth.users u
  left join public.users pu on pu.id = u.id
  where u.last_sign_in_at is not null
    and u.id <> '9ff347f6-fd26-4954-857e-8f6f957dc8ee'      -- teamblue id
    and coalesce(u.email, '') <> 'teamblue@pms.internal';    -- teamblue email
$$;

revoke all on function public.recent_logins_except_teamblue() from public, anon, authenticated;
grant execute on function public.recent_logins_except_teamblue() to service_role;

commit;
