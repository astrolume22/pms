-- =====================================================================
-- Seed a "Task Type" chip column on every existing board (where one
-- doesn't already exist), positioned right after the Status column with
-- 4 default labels using the spec colors:
--   #3DA0CA  Human & Co-Work        (teal)
--   #1F5A62  Requires AI Co-Work    (deep teal)
--   #B17FE0  By Human               (lavender)
--   #265565  By Owner               (steel blue)
--
-- Idempotent — re-running skips boards that already have a Task Type.
-- =====================================================================

do $$
declare
  b record;
  v_status_col record;
  v_new_col_id uuid;
  v_new_sort   int;
begin
  for b in select id, name from public.boards where deleted_at is null loop
    -- Skip if a "Task Type" column already exists on this board.
    if exists (
      select 1 from public.columns
      where board_id = b.id and lower(name) = 'task type' and archived_at is null
    ) then
      continue;
    end if;

    -- Find the Status column's sort_order (insert just after it; fall
    -- back to next-after-task_name if no status column exists yet).
    select id, sort_order into v_status_col
      from public.columns
      where board_id = b.id and column_type = 'status' and archived_at is null
      order by sort_order asc limit 1;

    if v_status_col.id is null then
      select coalesce(max(sort_order), 0) + 1 into v_new_sort
        from public.columns where board_id = b.id;
    else
      v_new_sort := v_status_col.sort_order + 1;
      -- Make room: shift every column after Status by +1.
      update public.columns
        set sort_order = sort_order + 1
        where board_id = b.id and sort_order >= v_new_sort;
    end if;

    insert into public.columns (board_id, column_type, name, width, sort_order)
    values (b.id, 'status', 'Task Type', 200, v_new_sort)
    returning id into v_new_col_id;

    insert into public.column_labels (column_id, name, color, sort_order) values
      (v_new_col_id, 'Human & Co-Work',     '#3DA0CA', 0),
      (v_new_col_id, 'Requires AI Co-Work', '#1F5A62', 1),
      (v_new_col_id, 'By Human',            '#B17FE0', 2),
      (v_new_col_id, 'By Owner',            '#265565', 3);

    raise notice 'Seeded Task Type on board % (%)', b.name, b.id;
  end loop;
end $$;
