-- =====================================================================
-- duplicate_board: handle the auto-seeded default columns/group
-- correctly.
--
-- Previous attempt tried to DELETE the auto-seeded task_name column
-- before copying the source's, but a guard trigger blocks any delete
-- on a task_name column. Instead: keep the auto-seeded task_name (and
-- map the source's task_name id → the new one) and delete only the
-- other auto-seeded columns/groups. Same idea for groups.
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
  v_seed_taskname_col uuid;
  v_src_taskname_col  uuid;
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

  -- Identify the auto-seeded task_name column on the new board (the
  -- boards-insert trigger created it). We CAN'T delete this one — a
  -- guard trigger blocks `delete from columns where task_name`. So we
  -- repurpose it: drop everything else, then map the source's
  -- task_name into this surviving id.
  select id into v_seed_taskname_col
    from public.columns
    where board_id = v_new_id and column_type = 'task_name' limit 1;

  -- Find source's task_name column id (if any) for the mapping.
  select id into v_src_taskname_col
    from public.columns
    where board_id = p_board_id and column_type = 'task_name' and archived_at is null
    limit 1;

  -- Delete any auto-seeded columns OTHER than task_name (and their labels).
  delete from public.column_labels where column_id in (
    select id from public.columns where board_id = v_new_id and column_type <> 'task_name'
  );
  delete from public.item_column_values where item_id in (
    select id from public.items where board_id = v_new_id
  );
  delete from public.items   where board_id = v_new_id;
  delete from public.columns where board_id = v_new_id and column_type <> 'task_name';
  delete from public.groups  where board_id = v_new_id;

  -- Pre-seed v_col_map so the source's task_name lands on the surviving
  -- auto-seeded column.
  if v_src_taskname_col is not null and v_seed_taskname_col is not null then
    v_col_map := v_col_map || jsonb_build_object(
      v_src_taskname_col::text, v_seed_taskname_col::text
    );
    -- Also align name/width on the surviving column to match the source.
    update public.columns set
      name = (select name from public.columns where id = v_src_taskname_col),
      width = (select width from public.columns where id = v_src_taskname_col),
      sort_order = (select sort_order from public.columns where id = v_src_taskname_col)
    where id = v_seed_taskname_col;
  end if;

  -- Columns (skip task_name — already handled).
  for c in
    select * from public.columns
    where board_id = p_board_id and archived_at is null and column_type <> 'task_name'
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

  -- Groups (auto-seeded groups already deleted above).
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

  -- Cell values (alias `it` to avoid plpgsql `i` row-var shadow).
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
