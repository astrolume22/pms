-- =====================================================================
-- Fix duplicate_board / duplicate_group from migration 0025:
--
-- 1) duplicate_board hit `columns_one_task_name_per_board` because the
--    board-creation trigger auto-seeds default columns (Task name +
--    others). When we then copied the source board's task_name column
--    on top, the partial unique index fired. Fix: delete auto-seeded
--    columns + auto-seeded groups on the new board before copying.
--
-- 2) Inside both functions the cell-values loop aliased `public.items`
--    as `i`, but the surrounding plpgsql function already binds `i` to
--    a row-variable used in earlier loops. Postgres flagged that
--    "i.id is ambiguous" / "i.board_id is ambiguous" / etc. when
--    parsing the inner query. Fix: rename the table alias to `it`.
-- =====================================================================

create or replace function public.duplicate_board(p_board_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_src         public.boards%rowtype;
  v_new_id      uuid := gen_random_uuid();
  v_new_name    text;
  v_col_map     jsonb := '{}'::jsonb;
  v_group_map   jsonb := '{}'::jsonb;
  v_item_map    jsonb := '{}'::jsonb;
  v_label_map   jsonb := '{}'::jsonb;
  c             record;
  g             record;
  l             record;
  i             record;
  v             record;
begin
  if not public.is_admin() then
    raise exception 'Only admins can duplicate boards' using errcode='42501';
  end if;
  select * into v_src from public.boards where id = p_board_id and deleted_at is null;
  if not found then raise exception 'Board not found' using errcode='22023'; end if;

  v_new_name := 'Copy of ' || v_src.name;

  insert into public.boards (
    id, workspace_id, name, description, icon_emoji, board_type,
    owner_id, created_by, settings, created_at, updated_at
  ) values (
    v_new_id, v_src.workspace_id, v_new_name, v_src.description, v_src.icon_emoji,
    v_src.board_type, auth.uid(), auth.uid(), v_src.settings, now(), now()
  );

  -- Drop the auto-seeded columns / groups that the boards-insert trigger
  -- created, otherwise the partial unique indexes (one_task_name etc.)
  -- collide with the source's columns.
  delete from public.column_labels  where column_id in (select id from public.columns where board_id = v_new_id);
  delete from public.item_column_values where item_id in (select id from public.items   where board_id = v_new_id);
  delete from public.items   where board_id = v_new_id;
  delete from public.columns where board_id = v_new_id;
  delete from public.groups  where board_id = v_new_id;

  -- Columns
  for c in
    select * from public.columns where board_id = p_board_id and archived_at is null
    order by sort_order asc
  loop
    declare v_new_col uuid := gen_random_uuid();
    begin
      insert into public.columns (id, board_id, column_type, name, width, sort_order, settings)
      values (v_new_col, v_new_id, c.column_type, c.name, c.width, c.sort_order, c.settings);
      v_col_map := v_col_map || jsonb_build_object(c.id::text, v_new_col::text);
    end;
  end loop;

  -- Column labels
  for l in
    select cl.* from public.column_labels cl
    join public.columns col on col.id = cl.column_id
    where col.board_id = p_board_id
    order by cl.sort_order asc
  loop
    declare
      v_new_label uuid := gen_random_uuid();
      v_new_col   uuid := (v_col_map ->> l.column_id::text)::uuid;
    begin
      if v_new_col is null then continue; end if;
      insert into public.column_labels (id, column_id, name, color, sort_order, is_default)
      values (v_new_label, v_new_col, l.name, l.color, l.sort_order, coalesce(l.is_default, false));
      v_label_map := v_label_map || jsonb_build_object(l.id::text, v_new_label::text);
    end;
  end loop;

  -- Groups
  for g in
    select * from public.groups where board_id = p_board_id and deleted_at is null
    order by sort_order asc
  loop
    declare v_new_group uuid := gen_random_uuid();
    begin
      insert into public.groups (id, board_id, name, color, sort_order, is_collapsed_default)
      values (v_new_group, v_new_id, g.name, g.color, g.sort_order, g.is_collapsed_default);
      v_group_map := v_group_map || jsonb_build_object(g.id::text, v_new_group::text);
    end;
  end loop;

  -- Top-level items
  for i in
    select * from public.items
    where board_id = p_board_id and deleted_at is null and parent_item_id is null
    order by sort_order asc
  loop
    declare
      v_new_item uuid := gen_random_uuid();
      v_new_grp  uuid := (v_group_map ->> i.group_id::text)::uuid;
    begin
      if v_new_grp is null then continue; end if;
      insert into public.items (id, board_id, group_id, parent_item_id, name, sort_order, created_by, updated_by)
      values (v_new_item, v_new_id, v_new_grp, null, i.name, i.sort_order, auth.uid(), auth.uid());
      v_item_map := v_item_map || jsonb_build_object(i.id::text, v_new_item::text);
    end;
  end loop;

  -- Subitems
  for i in
    select * from public.items
    where board_id = p_board_id and deleted_at is null and parent_item_id is not null
    order by sort_order asc
  loop
    declare
      v_new_item   uuid := gen_random_uuid();
      v_new_grp    uuid := (v_group_map ->> i.group_id::text)::uuid;
      v_new_parent uuid := (v_item_map  ->> i.parent_item_id::text)::uuid;
    begin
      if v_new_grp is null or v_new_parent is null then continue; end if;
      insert into public.items (id, board_id, group_id, parent_item_id, name, sort_order, created_by, updated_by)
      values (v_new_item, v_new_id, v_new_grp, v_new_parent, i.name, i.sort_order, auth.uid(), auth.uid());
      v_item_map := v_item_map || jsonb_build_object(i.id::text, v_new_item::text);
    end;
  end loop;

  -- Cell values. Note: table alias `it` (not `i`) to avoid colliding
  -- with the surrounding plpgsql row-variable `i`.
  for v in
    select icv.* from public.item_column_values icv
    join public.items it on it.id = icv.item_id
    where it.board_id = p_board_id
  loop
    declare
      v_new_item uuid := (v_item_map ->> v.item_id::text)::uuid;
      v_new_col  uuid := (v_col_map  ->> v.column_id::text)::uuid;
      v_new_val  jsonb := v.value;
    begin
      if v_new_item is null or v_new_col is null then continue; end if;

      if v_new_val ? 'label_id' and v_new_val->>'label_id' is not null then
        declare v_lid uuid := (v_label_map ->> (v_new_val->>'label_id'))::uuid;
        begin
          if v_lid is not null then
            v_new_val := jsonb_set(v_new_val, '{label_id}', to_jsonb(v_lid::text));
          end if;
        end;
      end if;

      if v_new_val ? 'label_ids' and jsonb_typeof(v_new_val->'label_ids') = 'array' then
        declare
          v_new_ids jsonb := '[]'::jsonb;
          v_lid     uuid;
          v_raw_id  jsonb;
        begin
          for v_raw_id in select * from jsonb_array_elements(v_new_val->'label_ids')
          loop
            v_lid := (v_label_map ->> trim(both '"' from v_raw_id::text))::uuid;
            if v_lid is not null then
              v_new_ids := v_new_ids || to_jsonb(v_lid::text);
            end if;
          end loop;
          v_new_val := jsonb_set(v_new_val, '{label_ids}', v_new_ids);
        end;
      end if;

      insert into public.item_column_values (item_id, column_id, value, updated_by)
      values (v_new_item, v_new_col, v_new_val, auth.uid())
      on conflict (item_id, column_id) do nothing;
    end;
  end loop;

  return v_new_id;
end;
$$;

revoke all on function public.duplicate_board(uuid) from public;
grant execute on function public.duplicate_board(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- duplicate_group — same alias fix.
-- ---------------------------------------------------------------------
create or replace function public.duplicate_group(p_group_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_src       public.groups%rowtype;
  v_new_id    uuid := gen_random_uuid();
  v_new_sort  int;
  v_item_map  jsonb := '{}'::jsonb;
  i           record;
  v           record;
begin
  if not public.is_admin() then
    raise exception 'Only admins can duplicate groups' using errcode='42501';
  end if;
  select * into v_src from public.groups where id = p_group_id and deleted_at is null;
  if not found then raise exception 'Group not found' using errcode='22023'; end if;

  select coalesce(max(sort_order), 0) + 1 into v_new_sort
    from public.groups where board_id = v_src.board_id;

  insert into public.groups (id, board_id, name, color, sort_order, is_collapsed_default)
  values (v_new_id, v_src.board_id, 'Copy of ' || v_src.name, v_src.color, v_new_sort, v_src.is_collapsed_default);

  for i in
    select * from public.items
    where group_id = p_group_id and deleted_at is null and parent_item_id is null
    order by sort_order asc
  loop
    declare v_new_item uuid := gen_random_uuid();
    begin
      insert into public.items (id, board_id, group_id, parent_item_id, name, sort_order, created_by, updated_by)
      values (v_new_item, v_src.board_id, v_new_id, null, i.name, i.sort_order, auth.uid(), auth.uid());
      v_item_map := v_item_map || jsonb_build_object(i.id::text, v_new_item::text);
    end;
  end loop;

  for i in
    select * from public.items
    where group_id = p_group_id and deleted_at is null and parent_item_id is not null
    order by sort_order asc
  loop
    declare
      v_new_item   uuid := gen_random_uuid();
      v_new_parent uuid := (v_item_map ->> i.parent_item_id::text)::uuid;
    begin
      if v_new_parent is null then continue; end if;
      insert into public.items (id, board_id, group_id, parent_item_id, name, sort_order, created_by, updated_by)
      values (v_new_item, v_src.board_id, v_new_id, v_new_parent, i.name, i.sort_order, auth.uid(), auth.uid());
      v_item_map := v_item_map || jsonb_build_object(i.id::text, v_new_item::text);
    end;
  end loop;

  -- Cell values — use `it` alias to dodge the plpgsql `i` row-variable.
  for v in
    select icv.* from public.item_column_values icv
    join public.items it on it.id = icv.item_id
    where it.group_id = p_group_id
  loop
    declare v_new_item uuid := (v_item_map ->> v.item_id::text)::uuid;
    begin
      if v_new_item is null then continue; end if;
      insert into public.item_column_values (item_id, column_id, value, updated_by)
      values (v_new_item, v.column_id, v.value, auth.uid())
      on conflict (item_id, column_id) do nothing;
    end;
  end loop;

  return v_new_id;
end;
$$;

revoke all on function public.duplicate_group(uuid) from public;
grant execute on function public.duplicate_group(uuid) to authenticated;
