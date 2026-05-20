-- =====================================================================
-- PMS Phase 3 — items / item_column_values / item_subscribers /
--               board_counters + RLS + task-code generator + triggers
-- Idempotent: safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- board_counters
-- One row per board.  Atomically incremented by the task-code generator
-- to hand out "Task 1", "Task 2", ...  Counter never decrements (so
-- numbers remain stable even after item deletes / archives).
-- ---------------------------------------------------------------------
create table if not exists public.board_counters (
  board_id uuid primary key,
  last_task_number int not null default 0,
  updated_at timestamptz not null default now(),
  constraint board_counters_board_fk
    foreign key (board_id) references public.boards(id) on delete cascade
);

-- ---------------------------------------------------------------------
-- items
-- ---------------------------------------------------------------------
create table if not exists public.items (
  id uuid primary key default uuid_generate_v4(),
  board_id uuid not null,
  group_id uuid not null,
  parent_item_id uuid,
  name text not null default 'New task',
  task_code text not null,
  sort_order int not null default 0,
  created_by uuid not null,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  deleted_at timestamptz,
  constraint items_board_fk
    foreign key (board_id) references public.boards(id) on delete cascade,
  constraint items_group_fk
    foreign key (group_id) references public.groups(id) on delete cascade,
  constraint items_parent_fk
    foreign key (parent_item_id) references public.items(id) on delete cascade,
  constraint items_created_by_fk
    foreign key (created_by) references public.users(id) on delete restrict,
  constraint items_updated_by_fk
    foreign key (updated_by) references public.users(id) on delete set null
);

-- Task code is unique within a board (across both top-level items
-- and subitems — codes look like "Task 1" vs "Task 1-A" so they
-- can coexist in the same namespace).
create unique index if not exists items_board_task_code_uq
  on public.items (board_id, task_code);

create index if not exists items_board_idx          on public.items (board_id);
create index if not exists items_group_sort_idx     on public.items (group_id, sort_order);
create index if not exists items_parent_idx         on public.items (parent_item_id);
create index if not exists items_active_idx         on public.items (board_id)
  where archived_at is null and deleted_at is null;
create index if not exists items_updated_at_desc_idx on public.items (updated_at desc);

-- ---------------------------------------------------------------------
-- item_column_values
-- Sparse — only rows that actually have a value live here.  Empty cells
-- are simply missing rows.
-- ---------------------------------------------------------------------
create table if not exists public.item_column_values (
  id uuid primary key default uuid_generate_v4(),
  item_id uuid not null,
  column_id uuid not null,
  value jsonb not null,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  constraint item_column_values_item_fk
    foreign key (item_id) references public.items(id) on delete cascade,
  constraint item_column_values_column_fk
    foreign key (column_id) references public.columns(id) on delete cascade,
  constraint item_column_values_updated_by_fk
    foreign key (updated_by) references public.users(id) on delete set null
);

create unique index if not exists item_column_values_item_column_uq
  on public.item_column_values (item_id, column_id);
create index if not exists item_column_values_column_idx
  on public.item_column_values (column_id);

-- ---------------------------------------------------------------------
-- item_subscribers
-- ---------------------------------------------------------------------
create table if not exists public.item_subscribers (
  item_id uuid not null,
  user_id uuid not null,
  subscribed_at timestamptz not null default now(),
  primary key (item_id, user_id),
  constraint item_subscribers_item_fk
    foreign key (item_id) references public.items(id) on delete cascade,
  constraint item_subscribers_user_fk
    foreign key (user_id) references public.users(id) on delete cascade
);

-- ---------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'items_updated_at') then
    create trigger items_updated_at before update on public.items
      for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'item_column_values_updated_at') then
    create trigger item_column_values_updated_at before update on public.item_column_values
      for each row execute function public.set_updated_at();
  end if;
end $$;

-- ---------------------------------------------------------------------
-- int_to_letters: 1→A, 26→Z, 27→AA, 28→AB...
-- ---------------------------------------------------------------------
create or replace function public.int_to_letters(_n int) returns text
language plpgsql immutable as $$
declare s text := ''; n int := _n;
begin
  if n is null or n <= 0 then return ''; end if;
  while n > 0 loop
    n := n - 1;
    s := chr(65 + (n % 26)) || s;
    n := n / 26;
  end loop;
  return s;
end;
$$;

-- ---------------------------------------------------------------------
-- generate_task_code
-- For top-level items: bumps board_counters, returns "Task N".
-- For subitems: counts existing siblings + 1, returns "{parent_code}-X".
-- ---------------------------------------------------------------------
create or replace function public.generate_task_code(
  _board_id uuid, _parent_item_id uuid
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_n int;
  v_parent_code text;
begin
  if _parent_item_id is null then
    insert into public.board_counters (board_id, last_task_number)
    values (_board_id, 1)
    on conflict (board_id)
    do update set last_task_number = public.board_counters.last_task_number + 1,
                  updated_at = now()
    returning last_task_number into v_n;
    return 'Task ' || v_n;
  end if;

  select task_code into v_parent_code from public.items where id = _parent_item_id;
  if v_parent_code is null then
    raise exception 'parent item % not found', _parent_item_id;
  end if;

  select count(*) + 1 into v_n
  from public.items
  where parent_item_id = _parent_item_id and deleted_at is null;

  return v_parent_code || '-' || public.int_to_letters(v_n);
end;
$$;

revoke all on function public.generate_task_code(uuid, uuid) from public;
grant execute on function public.generate_task_code(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- before_item_insert: fill task_code if empty, default sort_order
-- ---------------------------------------------------------------------
create or replace function public.before_item_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_max_sort int;
begin
  if new.task_code is null or length(trim(new.task_code)) = 0 then
    new.task_code := public.generate_task_code(new.board_id, new.parent_item_id);
  end if;
  -- Default sort_order = max in this group + 1 (subitems use sort within parent).
  if new.parent_item_id is null then
    select coalesce(max(sort_order), -1) + 1 into v_max_sort
    from public.items where group_id = new.group_id and parent_item_id is null;
  else
    select coalesce(max(sort_order), -1) + 1 into v_max_sort
    from public.items where parent_item_id = new.parent_item_id;
  end if;
  if new.sort_order = 0 then
    new.sort_order := v_max_sort;
  end if;
  return new;
end;
$$;

drop trigger if exists before_item_insert on public.items;
create trigger before_item_insert
  before insert on public.items
  for each row execute function public.before_item_insert();

-- ---------------------------------------------------------------------
-- after_item_insert: log item_created
-- ---------------------------------------------------------------------
create or replace function public.after_item_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.activity_log (actor_id, action_type, target_type, target_id, new_value)
  values (new.created_by, 'item_created', 'item', new.id,
          jsonb_build_object(
            'board_id', new.board_id,
            'group_id', new.group_id,
            'parent_item_id', new.parent_item_id,
            'task_code', new.task_code,
            'name', new.name
          ));
  return new;
end;
$$;

drop trigger if exists after_item_insert on public.items;
create trigger after_item_insert
  after insert on public.items
  for each row execute function public.after_item_insert();

-- ---------------------------------------------------------------------
-- after_item_update: log rename / archive / restore / delete
-- ---------------------------------------------------------------------
create or replace function public.after_item_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null then return new; end if;
  if new.name is distinct from old.name then
    insert into public.activity_log (actor_id, action_type, target_type, target_id, old_value, new_value)
    values (v_actor, 'item_renamed', 'item', new.id,
            jsonb_build_object('name', old.name),
            jsonb_build_object('name', new.name));
  end if;
  if (new.archived_at is not null and old.archived_at is null) then
    insert into public.activity_log (actor_id, action_type, target_type, target_id)
    values (v_actor, 'item_archived', 'item', new.id);
  elsif (new.archived_at is null and old.archived_at is not null) then
    insert into public.activity_log (actor_id, action_type, target_type, target_id)
    values (v_actor, 'item_restored', 'item', new.id);
  end if;
  if (new.deleted_at is not null and old.deleted_at is null) then
    insert into public.activity_log (actor_id, action_type, target_type, target_id)
    values (v_actor, 'item_deleted', 'item', new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists after_item_update on public.items;
create trigger after_item_update
  after update on public.items
  for each row execute function public.after_item_update();

-- ---------------------------------------------------------------------
-- after value change: log value_changed
-- ---------------------------------------------------------------------
create or replace function public.after_value_upsert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_item_id uuid;
  v_column_id uuid;
  v_old jsonb;
  v_new jsonb;
begin
  if v_actor is null then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then
    v_item_id := old.item_id;
    v_column_id := old.column_id;
    v_old := old.value;
    v_new := null;
  else
    v_item_id := new.item_id;
    v_column_id := new.column_id;
    v_old := case when tg_op = 'UPDATE' then old.value else null end;
    v_new := new.value;
    if tg_op = 'UPDATE' and v_old is not distinct from v_new then
      return new;
    end if;
  end if;
  insert into public.activity_log (actor_id, action_type, target_type, target_id, old_value, new_value)
  values (v_actor, 'value_changed', 'item', v_item_id,
          jsonb_build_object('column_id', v_column_id, 'value', v_old),
          jsonb_build_object('column_id', v_column_id, 'value', v_new));
  return coalesce(new, old);
end;
$$;

drop trigger if exists after_value_change on public.item_column_values;
create trigger after_value_change
  after insert or update or delete on public.item_column_values
  for each row execute function public.after_value_upsert();

-- ---------------------------------------------------------------------
-- guard_task_name_column_delete: never delete task_name columns
-- (and never change a task_name column's type)
-- ---------------------------------------------------------------------
create or replace function public.guard_task_name_column() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' and old.column_type = 'task_name' then
    raise exception 'Cannot delete the task_name column';
  end if;
  if tg_op = 'UPDATE' and old.column_type = 'task_name' and new.column_type <> 'task_name' then
    raise exception 'Cannot change the type of the task_name column';
  end if;
  return case tg_op when 'DELETE' then old else new end;
end;
$$;

drop trigger if exists guard_task_name_column on public.columns;
create trigger guard_task_name_column
  before update or delete on public.columns
  for each row execute function public.guard_task_name_column();
