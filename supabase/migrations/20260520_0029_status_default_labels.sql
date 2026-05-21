-- =====================================================================
-- Seed 10 "premium" default labels on every existing status-type column
-- so the picker grid feels filled-out, not sparse. Idempotent by
-- (column_id, lower(name)) — labels with a matching name on a column
-- get their color re-aligned to the spec, anything else is inserted
-- with the next available sort_order.
--
-- Spec colors (do not change):
--   Done             #4CD297
--   New update       #F64F9F
--   Working on it    #FDBB71
--   Paused           #F68A5C
--   Stuck            #E16E7F
--   Requires owner   #7BB0F6
--   Not Started      #777E91
--   On Hold          #C26175
--   Need Help        #419DCC
--   Daily Task       #B280DF
-- =====================================================================

do $$
declare
  v_col       record;
  v_seed      record;
  v_next_sort int;
  v_existing  uuid;
  v_seeds     constant jsonb := jsonb_build_array(
    jsonb_build_object('name','Done',            'color','#4CD297'),
    jsonb_build_object('name','New update',      'color','#F64F9F'),
    jsonb_build_object('name','Working on it',   'color','#FDBB71'),
    jsonb_build_object('name','Paused',          'color','#F68A5C'),
    jsonb_build_object('name','Stuck',           'color','#E16E7F'),
    jsonb_build_object('name','Requires owner',  'color','#7BB0F6'),
    jsonb_build_object('name','Not Started',     'color','#777E91'),
    jsonb_build_object('name','On Hold',         'color','#C26175'),
    jsonb_build_object('name','Need Help',       'color','#419DCC'),
    jsonb_build_object('name','Daily Task',      'color','#B280DF')
  );
begin
  -- For every status column that isn't the "Task Type" custom column,
  -- seed any missing labels and recolor existing ones to the spec.
  for v_col in
    select id, name from public.columns
    where column_type = 'status' and archived_at is null
      and lower(name) <> 'task type'
  loop
    select coalesce(max(sort_order), -1) + 1 into v_next_sort
      from public.column_labels where column_id = v_col.id;

    for v_seed in select * from jsonb_to_recordset(v_seeds) as x(name text, color text) loop
      select id into v_existing
        from public.column_labels
        where column_id = v_col.id and lower(name) = lower(v_seed.name)
        limit 1;

      if v_existing is null then
        insert into public.column_labels (column_id, name, color, sort_order)
        values (v_col.id, v_seed.name, v_seed.color, v_next_sort);
        v_next_sort := v_next_sort + 1;
      else
        -- Re-align color to the spec so the chip looks correct.
        update public.column_labels set color = v_seed.color where id = v_existing;
      end if;
    end loop;
  end loop;
end $$;
