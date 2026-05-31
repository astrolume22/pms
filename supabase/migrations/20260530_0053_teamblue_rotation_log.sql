-- =====================================================================
-- 0053 — teamblue backup-login rotation reminder (ADDITIVE ONLY).
--
-- Adds ONE new table + two helper functions. It does NOT:
--   • alter any auth.* table (it only READS auth.users / auth.audit_log
--     via a SECURITY DEFINER function — never writes there),
--   • change RLS on any existing table,
--   • touch the invite flow, the reset flow, existing crons, the
--     answers table, or any existing data.
--
-- Background: teamblue (auth user 9ff347f6-fd26-4954-857e-8f6f957dc8ee,
-- teamblue@pms.internal) is a shared backup login Sylvia hands to
-- verified hires. Every sign-in now means a real candidate to rotate +
-- re-invite. The /api/check-teamblue-login cron reads this user's
-- last_sign_in_at; when it advances past the newest row here, it logs a
-- new event and emails HR. A 72h chaser fires if still not rotated.
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- New table — one row per detected teamblue login event.
-- ---------------------------------------------------------------------
create table if not exists public.teamblue_rotation_log (
  id               uuid primary key default gen_random_uuid(),
  login_at         timestamptz not null,
  login_ip         text,
  login_location   text,
  reminder_sent_at timestamptz,
  chaser_sent_at   timestamptz,
  rotated          boolean not null default false,
  created_at       timestamptz not null default now()
);

-- One row per distinct login timestamp. Belt-and-suspenders against a
-- double-insert if two cron ticks overlap (the endpoint also guards in
-- code). Additive index — affects nothing else.
create unique index if not exists teamblue_rotation_log_login_at_key
  on public.teamblue_rotation_log (login_at);

-- RLS on. The cron uses the service role (bypasses RLS). The only
-- user-facing surfaces are: admins may READ the log, and the
-- mark_teamblue_rotated() SECURITY DEFINER function below. No INSERT /
-- UPDATE / DELETE policy is granted to end users by design.
alter table public.teamblue_rotation_log enable row level security;

drop policy if exists teamblue_rotation_log_select_admin on public.teamblue_rotation_log;
create policy teamblue_rotation_log_select_admin
  on public.teamblue_rotation_log for select
  to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------
-- teamblue_last_login() — READ-ONLY peek at the auth schema for the
-- teamblue user. Returns last_sign_in_at + the IP from that user's most
-- recent audit entry. SECURITY DEFINER so it can see auth.*; it only
-- SELECTs and NEVER writes to or alters any auth table. Execute is
-- restricted to the service role (the cron) — not exposed to users.
-- ---------------------------------------------------------------------
create or replace function public.teamblue_last_login()
returns table (login_at timestamptz, login_ip text)
language sql
stable
security definer
set search_path = public, auth
as $$
  select
    u.last_sign_in_at as login_at,
    (
      select a.ip_address::text
      from auth.audit_log_entries a
      where (a.payload->>'actor_id') = u.id::text
        and a.ip_address is not null
        and a.ip_address <> ''
      order by a.created_at desc
      limit 1
    ) as login_ip
  from auth.users u
  where u.id = '9ff347f6-fd26-4954-857e-8f6f957dc8ee';
$$;

revoke all on function public.teamblue_last_login() from public, anon, authenticated;
grant execute on function public.teamblue_last_login() to service_role;

-- ---------------------------------------------------------------------
-- mark_teamblue_rotated() — admin-only. Marks the most recent
-- not-yet-rotated login row as rotated so the 72h chaser is suppressed.
-- Single-row UPDATE by exact id (data rule). Returns true if a row was
-- marked, false if there was nothing to mark.
-- ---------------------------------------------------------------------
create or replace function public.mark_teamblue_rotated()
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  target uuid;
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'admins only';
  end if;

  select id into target
  from public.teamblue_rotation_log
  where rotated = false
  order by login_at desc
  limit 1;

  if target is null then
    return false;
  end if;

  update public.teamblue_rotation_log
     set rotated = true
   where id = target;   -- single-row write by exact id

  return true;
end;
$$;

revoke all on function public.mark_teamblue_rotated() from public, anon;
grant execute on function public.mark_teamblue_rotated() to authenticated;

commit;
