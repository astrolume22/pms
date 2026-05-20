-- =====================================================================
-- PMS Phase 4 — Updates / Reactions / Mentions / Files / Notifications
--               + extend column types with 'files'
-- =====================================================================

-- ---------------------------------------------------------------------
-- Extend column_type CHECK to allow 'files'
-- (The original constraint enforced 10 types; we now allow 11.)
-- ---------------------------------------------------------------------
alter table public.columns drop constraint if exists columns_column_type_check;
alter table public.columns add constraint columns_column_type_check
  check (column_type in (
    'task_name','text','status','people','date','priority',
    'numbers','checkbox','dropdown','link','files'
  ));

-- ---------------------------------------------------------------------
-- updates (comments / discussion posts on items)
-- ---------------------------------------------------------------------
create table if not exists public.updates (
  id uuid primary key default uuid_generate_v4(),
  item_id uuid not null,
  author_id uuid not null,
  body_html text not null,
  body_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  constraint updates_item_fk
    foreign key (item_id) references public.items(id) on delete cascade,
  constraint updates_author_fk
    foreign key (author_id) references public.users(id) on delete restrict
);

create index if not exists updates_item_created_idx on public.updates (item_id, created_at desc) where deleted_at is null;

-- ---------------------------------------------------------------------
-- update_reactions
-- ---------------------------------------------------------------------
create table if not exists public.update_reactions (
  update_id uuid not null,
  user_id uuid not null,
  emoji text not null,
  created_at timestamptz not null default now(),
  primary key (update_id, user_id, emoji),
  constraint update_reactions_update_fk
    foreign key (update_id) references public.updates(id) on delete cascade,
  constraint update_reactions_user_fk
    foreign key (user_id) references public.users(id) on delete cascade
);

-- ---------------------------------------------------------------------
-- update_mentions
-- ---------------------------------------------------------------------
create table if not exists public.update_mentions (
  update_id uuid not null,
  mentioned_user_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (update_id, mentioned_user_id),
  constraint update_mentions_update_fk
    foreign key (update_id) references public.updates(id) on delete cascade,
  constraint update_mentions_user_fk
    foreign key (mentioned_user_id) references public.users(id) on delete cascade
);

-- ---------------------------------------------------------------------
-- files
-- One file row links to either an update (comment attachment) or to an
-- item (files-tab attachment).  When also tied to a column it lives in
-- a 'files' column cell on that item.
-- ---------------------------------------------------------------------
create table if not exists public.files (
  id uuid primary key default uuid_generate_v4(),
  uploader_id uuid not null,
  item_id uuid,
  update_id uuid,
  column_id uuid,
  storage_path text not null,
  file_name text not null,
  file_size bigint not null,
  mime_type text not null,
  thumbnail_path text,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint files_uploader_fk
    foreign key (uploader_id) references public.users(id) on delete restrict,
  constraint files_item_fk
    foreign key (item_id) references public.items(id) on delete cascade,
  constraint files_update_fk
    foreign key (update_id) references public.updates(id) on delete cascade,
  constraint files_column_fk
    foreign key (column_id) references public.columns(id) on delete cascade,
  constraint files_must_have_parent
    check ((item_id is not null) or (update_id is not null))
);

create index if not exists files_item_idx   on public.files (item_id) where deleted_at is null;
create index if not exists files_update_idx on public.files (update_id) where deleted_at is null;
create index if not exists files_column_idx on public.files (column_id, item_id) where deleted_at is null;

-- ---------------------------------------------------------------------
-- notifications
-- ---------------------------------------------------------------------
create table if not exists public.notifications (
  id uuid primary key default uuid_generate_v4(),
  recipient_id uuid not null,
  actor_id uuid,
  type text not null check (type in (
    'mention','comment','assigned','status_changed','due_date','task_updated'
  )),
  item_id uuid,
  update_id uuid,
  board_id uuid,
  is_read boolean not null default false,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint notif_recipient_fk
    foreign key (recipient_id) references public.users(id) on delete cascade,
  constraint notif_actor_fk
    foreign key (actor_id) references public.users(id) on delete set null,
  constraint notif_item_fk
    foreign key (item_id) references public.items(id) on delete cascade,
  constraint notif_update_fk
    foreign key (update_id) references public.updates(id) on delete cascade,
  constraint notif_board_fk
    foreign key (board_id) references public.boards(id) on delete cascade
);

create index if not exists notifications_recipient_unread_idx
  on public.notifications (recipient_id, is_read, created_at desc);

-- ---------------------------------------------------------------------
-- updated_at + edit tracking triggers
-- ---------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'updates_updated_at') then
    create trigger updates_updated_at before update on public.updates
      for each row execute function public.set_updated_at();
  end if;
end $$;

-- Mark edited_at whenever body changes
create or replace function public.before_update_edit() returns trigger
language plpgsql as $$
begin
  if new.body_html is distinct from old.body_html
     or new.body_json is distinct from old.body_json then
    new.edited_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists before_update_edit on public.updates;
create trigger before_update_edit
  before update on public.updates
  for each row execute function public.before_update_edit();

-- ---------------------------------------------------------------------
-- After-insert on updates: log activity + notify item owner + bump
-- the item's updated_at (so the board "Recents" UI reflects activity).
-- ---------------------------------------------------------------------
create or replace function public.after_update_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_item record;
begin
  insert into public.activity_log (actor_id, action_type, target_type, target_id, new_value)
  values (new.author_id, 'update_added', 'item', new.item_id,
          jsonb_build_object('update_id', new.id));

  -- Look up the item's owner + board for notifications.
  select created_by, board_id into v_item from public.items where id = new.item_id;

  if v_item.created_by is not null and v_item.created_by <> new.author_id then
    insert into public.notifications (recipient_id, actor_id, type, item_id, update_id, board_id)
    values (v_item.created_by, new.author_id, 'comment', new.item_id, new.id, v_item.board_id);
  end if;

  -- Touch the item so recently-updated items bubble up.
  update public.items set updated_at = now() where id = new.item_id;
  return new;
end;
$$;

drop trigger if exists after_update_insert on public.updates;
create trigger after_update_insert
  after insert on public.updates
  for each row execute function public.after_update_insert();

-- ---------------------------------------------------------------------
-- After-insert on update_mentions: create 'mention' notification.
-- ---------------------------------------------------------------------
create or replace function public.after_mention_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_update record;
  v_item record;
begin
  select * into v_update from public.updates where id = new.update_id;
  if v_update.author_id = new.mentioned_user_id then return new; end if;  -- don't self-notify
  select board_id into v_item from public.items where id = v_update.item_id;
  insert into public.notifications (recipient_id, actor_id, type, item_id, update_id, board_id)
  values (new.mentioned_user_id, v_update.author_id, 'mention', v_update.item_id, v_update.id, v_item.board_id);
  return new;
end;
$$;

drop trigger if exists after_mention_insert on public.update_mentions;
create trigger after_mention_insert
  after insert on public.update_mentions
  for each row execute function public.after_mention_insert();

-- ---------------------------------------------------------------------
-- After-insert on files: log activity (file_uploaded) and bump item.
-- ---------------------------------------------------------------------
create or replace function public.after_file_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_actor uuid := new.uploader_id;
begin
  insert into public.activity_log (actor_id, action_type, target_type, target_id, new_value)
  values (v_actor, 'file_uploaded',
          case when new.item_id is not null then 'item' else 'update' end,
          coalesce(new.item_id, new.update_id),
          jsonb_build_object('file_id', new.id, 'name', new.file_name, 'size', new.file_size));

  if new.item_id is not null then
    update public.items set updated_at = now() where id = new.item_id;
  end if;
  return new;
end;
$$;

drop trigger if exists after_file_insert on public.files;
create trigger after_file_insert
  after insert on public.files
  for each row execute function public.after_file_insert();

-- ---------------------------------------------------------------------
-- After value upsert on people column: notify newly-added assignees.
-- We rewrite the existing after_value_upsert function to ALSO emit
-- 'assigned' notifications when a people column adds user_ids.
-- ---------------------------------------------------------------------
create or replace function public.after_value_upsert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_item_id uuid;
  v_column_id uuid;
  v_old jsonb;
  v_new jsonb;
  v_column record;
  v_board_id uuid;
  v_old_ids text[];
  v_new_ids text[];
  v_added text;
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

  -- 'Assigned' notifications when a people column adds new user_ids.
  select column_type, board_id into v_column
  from public.columns where id = v_column_id;

  if v_column.column_type = 'people' and v_new is not null then
    select board_id into v_board_id from public.items where id = v_item_id;
    v_old_ids := case when v_old is null then array[]::text[]
                       else array(select jsonb_array_elements_text(coalesce(v_old->'user_ids','[]'::jsonb))) end;
    v_new_ids := array(select jsonb_array_elements_text(coalesce(v_new->'user_ids','[]'::jsonb)));
    foreach v_added in array v_new_ids loop
      if not (v_added = any(v_old_ids)) and v_added <> v_actor::text then
        insert into public.notifications (recipient_id, actor_id, type, item_id, board_id)
        values (v_added::uuid, v_actor, 'assigned', v_item_id, v_board_id);
      end if;
    end loop;
  end if;

  return coalesce(new, old);
end;
$$;
