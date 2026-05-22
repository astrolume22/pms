-- =====================================================================
-- RLS self-reference fix + soft-delete UPDATE fix + board-delete trigger
--
-- Three latent bugs found via JWT repro + pg_policies audit:
--
-- BUG 1 — items_select (and boards_select_accessible) called helper
--   functions that self-query the same table:
--     can_access_item(items.id)  →  exists (select 1 from items where id=$1 and deleted_at is null)
--     can_access_board(boards.id) →  exists (select 1 from boards where id=$1 and deleted_at is null)
--   Postgres evaluates SELECT policy USING against the new row image
--   when INSERT...RETURNING / UPDATE...RETURNING fires (this includes
--   PostgREST's `.select().single()` chain via Prefer: return=representation).
--   A STABLE SECURITY DEFINER function's snapshot does NOT see the new
--   row inside the same statement, so the `exists` returns false and
--   the whole USING returns false → Postgres raises 42501
--   ("new row violates row-level security policy") for what should be
--   a valid insert.
--
--   FIX: inline the access check on the same row directly via row
--   references (items.board_id, items.group_id, boards.id, etc.) so
--   the policy reads the *new row's own values* without re-querying
--   the table. Semantics are preserved exactly — see scripts in the
--   commit's verification proofs.
--
-- BUG 2 — boards_select_accessible carried `(deleted_at IS NULL)` in
--   its USING clause. Migration 0014 already removed this pattern from
--   items / updates / files / etc. but 0028 rewrote boards_select
--   and silently re-introduced it. Soft-deleting a board sets
--   deleted_at; the UPDATE-RETURNING policy check then fails on the
--   new row image. Audit confirmed only boards_select_accessible
--   regressed — items_select had this same line but the helper bug
--   above masked it.
--
--   FIX: drop the `deleted_at IS NULL` from the policy USING. The app
--   already filters `is('deleted_at', null)` in every boards query,
--   so this doesn't widen UI visibility.
--
-- BUG 3 — `guard_task_name_column` BEFORE DELETE trigger on columns
--   raises "Cannot delete the task_name column" unconditionally. When
--   a board is hard-deleted, the FK cascade DELETEs every column on
--   that board including its task_name column → trigger aborts the
--   whole DELETE BOARD statement.
--
--   FIX: a transaction-local flag set by a BEFORE DELETE trigger on
--   boards. The column guard checks the flag and allows the cascade
--   deletion to proceed. The flag uses `set_config(..., is_local := true)`
--   so it's auto-cleared at COMMIT/ROLLBACK and cannot leak between
--   requests.
--
-- =====================================================================

-- ---------------------------------------------------------------------
-- BUG 1+2 — items_select: inline the access check, drop self-reference
-- ---------------------------------------------------------------------
drop policy if exists items_select on public.items;
create policy items_select on public.items for select to authenticated
  using (
    deleted_at is null
    -- Preserve can_access_item()'s exact semantics:
    --   (a) caller must be an active user
    --   (b) admin sees everything; otherwise a board_subscribers row
    --       must exist scoped to NULL (full board) or to this exact
    --       items.group_id (group-scoped manager isolation).
    and public.is_active_user()
    and (
      public.is_admin()
      or exists (
        select 1 from public.board_subscribers bs
        where bs.board_id = items.board_id
          and bs.user_id  = auth.uid()
          and (bs.group_id is null or bs.group_id = items.group_id)
      )
    )
  );

-- ---------------------------------------------------------------------
-- BUG 1+2 — boards_select_accessible: same fix pattern
-- ---------------------------------------------------------------------
drop policy if exists boards_select_accessible on public.boards;
create policy boards_select_accessible on public.boards for select to authenticated
  using (
    public.is_active_user()
    and (
      public.is_admin()
      or exists (
        select 1 from public.board_subscribers bs
        where bs.board_id = boards.id
          and bs.user_id  = auth.uid()
      )
    )
  );
-- Note: `deleted_at IS NULL` is intentionally NOT in the USING (see
-- the 0014 fix). UI queries continue to filter via `.is('deleted_at',
-- null)` so soft-deleted boards remain hidden in the sidebar.

-- ---------------------------------------------------------------------
-- BUG 3 — let board hard-delete cascade past the task_name guard
-- ---------------------------------------------------------------------
create or replace function public.flag_cascading_board_delete()
returns trigger
language plpgsql as $$
begin
  -- Transaction-local flag the column guard reads. is_local=true so
  -- the setting clears at COMMIT/ROLLBACK and never leaks to other
  -- requests served by the same Postgres backend.
  perform set_config('pms.cascading_board_delete', 'true', true);
  return old;
end;
$$;

drop trigger if exists before_board_delete_flag on public.boards;
create trigger before_board_delete_flag
  before delete on public.boards
  for each row execute function public.flag_cascading_board_delete();

create or replace function public.guard_task_name_column()
returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' and old.column_type = 'task_name' then
    -- Allow if we're inside the cascade from a boards DELETE.
    if current_setting('pms.cascading_board_delete', true) = 'true' then
      return old;
    end if;
    raise exception 'Cannot delete the task_name column';
  end if;
  if tg_op = 'UPDATE'
     and old.column_type = 'task_name'
     and new.column_type <> 'task_name' then
    raise exception 'Cannot change the type of the task_name column';
  end if;
  return case tg_op when 'DELETE' then old else new end;
end;
$$;
