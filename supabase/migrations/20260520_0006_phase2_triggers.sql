-- =====================================================================
-- PMS Phase 2 — Triggers
--   • After board insert  → subscribe creator as owner, seed group,
--     5 default columns, 4 status labels, 4 priority labels, log activity
--   • After board update  → log rename / archive / restore
-- =====================================================================

-- ---------------------------------------------------------------------
-- after_board_insert: bootstrap defaults
-- Runs SECURITY DEFINER so the bootstrap inserts bypass RLS.
-- ---------------------------------------------------------------------
create or replace function public.after_board_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_status_col_id   uuid;
  v_priority_col_id uuid;
  v_group_id        uuid;
begin
  -- 1. Subscribe creator as owner.
  insert into public.board_subscribers (board_id, user_id, role, notification_level)
  values (new.id, new.created_by, 'owner', 'everything')
  on conflict (board_id, user_id) do nothing;

  -- 2. Default group.
  insert into public.groups (board_id, name, color, sort_order)
  values (new.id, 'Group Title', '#579BFC', 0)
  returning id into v_group_id;

  -- 3. Five default columns (sort_order matches Monday's default board).
  insert into public.columns (board_id, name, column_type, sort_order, is_pinned_left, width) values
    (new.id, 'Task',     'task_name', 0, true, 280);

  insert into public.columns (board_id, name, column_type, sort_order, width)
  values (new.id, 'Status',   'status',   1, 140)
  returning id into v_status_col_id;

  insert into public.columns (board_id, name, column_type, sort_order, width)
  values (new.id, 'Owner',    'people',   2, 140);

  insert into public.columns (board_id, name, column_type, sort_order, width)
  values (new.id, 'Date',     'date',     3, 130);

  insert into public.columns (board_id, name, column_type, sort_order, width)
  values (new.id, 'Priority', 'priority', 4, 130)
  returning id into v_priority_col_id;

  -- 4. Status labels.
  insert into public.column_labels (column_id, name, color, sort_order, is_default) values
    (v_status_col_id, 'Not Started',    '#C4C4C4', 0, true),
    (v_status_col_id, 'Working on it',  '#FDAB3D', 1, false),
    (v_status_col_id, 'Stuck',          '#E2445C', 2, false),
    (v_status_col_id, 'Done',           '#00C875', 3, false);

  -- 5. Priority labels.
  insert into public.column_labels (column_id, name, color, sort_order, is_default) values
    (v_priority_col_id, 'Low',      '#579BFC', 0, true),
    (v_priority_col_id, 'Medium',   '#FFCB00', 1, false),
    (v_priority_col_id, 'High',     '#FDAB3D', 2, false),
    (v_priority_col_id, 'Critical', '#E2445C', 3, false);

  -- 6. Activity log.
  insert into public.activity_log (actor_id, action_type, target_type, target_id, new_value)
  values (new.created_by, 'board_created', 'board', new.id,
          jsonb_build_object('name', new.name, 'board_type', new.board_type));

  return new;
end;
$$;

drop trigger if exists after_board_insert on public.boards;
create trigger after_board_insert
  after insert on public.boards
  for each row execute function public.after_board_insert();

-- ---------------------------------------------------------------------
-- after_board_update: log meaningful changes
-- Stays in the caller's session so auth.uid() is the actor.
-- ---------------------------------------------------------------------
create or replace function public.after_board_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    -- No session — skip logging (e.g. server-side maintenance).
    return new;
  end if;

  if new.name is distinct from old.name then
    insert into public.activity_log (actor_id, action_type, target_type, target_id, old_value, new_value)
    values (v_actor, 'board_renamed', 'board', new.id,
            jsonb_build_object('name', old.name),
            jsonb_build_object('name', new.name));
  end if;

  if (new.archived_at is not null and old.archived_at is null) then
    insert into public.activity_log (actor_id, action_type, target_type, target_id)
    values (v_actor, 'board_archived', 'board', new.id);
  elsif (new.archived_at is null and old.archived_at is not null) then
    insert into public.activity_log (actor_id, action_type, target_type, target_id)
    values (v_actor, 'board_restored', 'board', new.id);
  end if;

  if (new.deleted_at is not null and old.deleted_at is null) then
    insert into public.activity_log (actor_id, action_type, target_type, target_id)
    values (v_actor, 'board_deleted', 'board', new.id);
  end if;

  return new;
end;
$$;

drop trigger if exists after_board_update on public.boards;
create trigger after_board_update
  after update on public.boards
  for each row execute function public.after_board_update();
