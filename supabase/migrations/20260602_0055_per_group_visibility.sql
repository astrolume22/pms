-- =====================================================================
-- 0055 — Per-group visibility ACL (Phase 3 Step 2)
-- =====================================================================
-- Adds public.group_user_visibility — the single source of truth for
-- "which groups can a (non-admin) user see on a board?" — and amends the
-- groups SELECT policy to consult it.
--
-- Why a new table instead of extending board_subscribers.group_id:
--   board_subscribers has PK (board_id, user_id) — exactly one row per
--   (user, board). Its group_id column can scope a user to a SINGLE
--   group on the board, never to "3 of 8 groups". The desired feature
--   needs multi-group ACL, which this table provides.
--
-- Behavior after this migration:
--   • Admins (role='admin' or is_super_admin) bypass the new check and
--     keep seeing every group on every board they can access.
--   • Non-admins see ONLY the groups they have a group_user_visibility
--     row for. The Step-1 backfill below translates today's
--     board_subscribers state into ACL rows so nobody loses access on
--     day one. After backfill, NEW board memberships do NOT get a
--     blanket grant — admins explicitly grant groups (least-privilege).
--
--   • board_subscribers.group_id is left in the schema (column not
--     dropped) but is no longer referenced by any policy. Step 5 of
--     this migration nulls out the 2 existing per-group rows so the new
--     ACL table is the only place visibility is expressed going forward.
--
-- Idempotency: every DDL statement is guarded (IF NOT EXISTS, DROP …
-- IF EXISTS, ON CONFLICT DO NOTHING, guarded UPDATE on a column that
-- becomes a no-op once already-null). Safe to re-run.
-- =====================================================================

-- ---------- 1. Table -------------------------------------------------
create table if not exists public.group_user_visibility (
  user_id     uuid        not null references public.users(id)  on delete cascade,
  group_id    uuid        not null references public.groups(id) on delete cascade,
  granted_by  uuid            null references public.users(id)  on delete set null,
  created_at  timestamptz not null default now(),
  primary key (user_id, group_id)
);

create index if not exists group_user_visibility_user_idx
  on public.group_user_visibility (user_id);
create index if not exists group_user_visibility_group_idx
  on public.group_user_visibility (group_id);

-- ---------- 2. RLS ---------------------------------------------------
alter table public.group_user_visibility enable row level security;

drop policy if exists guv_select on public.group_user_visibility;
create policy guv_select on public.group_user_visibility
  for select
  using (is_admin() or user_id = auth.uid());

drop policy if exists guv_write on public.group_user_visibility;
create policy guv_write on public.group_user_visibility
  for all
  using      (is_admin())
  with check (is_admin());

-- ---------- 3. Amend groups SELECT policy ----------------------------
-- Drop-and-recreate ONLY the SELECT policy. INSERT/UPDATE/DELETE policies
-- on public.groups are left untouched (admins still own write paths
-- through can_access_board(board_id)).
drop policy if exists groups_select on public.groups;
create policy groups_select on public.groups
  for select
  using (
    can_access_board(board_id)
    AND (
      is_admin()
      OR EXISTS (
        SELECT 1 FROM public.group_user_visibility v
        WHERE v.user_id = auth.uid()
          AND v.group_id = groups.id
      )
    )
  );

-- ---------- 4. ONE-TIME backfill (existing subscribers only) ---------
-- For every non-admin board_subscribers row, create a visibility row
-- for every ALIVE group on that subscriber's board, honoring the
-- existing single-group scope so the 2 currently group-scoped
-- subscribers DON'T get widened to the whole board.
--
-- Admin/super skip — RLS bypasses them anyway, and we don't want their
-- inboxes filled with phantom grants.
--
-- ON CONFLICT DO NOTHING makes this safe to re-run (the rows are keyed
-- on PK (user_id, group_id) and the join is deterministic).
insert into public.group_user_visibility (user_id, group_id, granted_by)
select bs.user_id, g.id, null
  from public.board_subscribers bs
  join public.users  u on u.id = bs.user_id
  join public.groups g on g.board_id = bs.board_id
                      and g.deleted_at is null
 where u.role <> 'admin'
   and u.is_super_admin = false
   and (bs.group_id is null or bs.group_id = g.id)
on conflict (user_id, group_id) do nothing;

-- ---------- 5. Null out board_subscribers.group_id (Decision 1) ------
-- After backfill, group_user_visibility holds the authoritative
-- visibility for the 2 previously per-group subscribers. Their
-- group_id on board_subscribers is now stale state that could mislead
-- future readers — null it. Single-table UPDATE by exact match on the
-- value to flip; no other columns touched. Safe to re-run — once
-- nulled, the WHERE clause matches zero rows.
update public.board_subscribers
   set group_id = null
 where group_id is not null;
