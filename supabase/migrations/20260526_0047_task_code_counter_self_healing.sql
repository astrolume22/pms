-- =====================================================================
-- 0047 — make generate_task_code() self-healing + backfill board_counters.
--
-- Bug captured live: clicking "Duplicate" on a group fails with
--   23505 / "duplicate key value violates unique constraint
--   items_board_task_code_uq"
--   details: Key (board_id, task_code)=(<board>, Task 1) already exists.
--
-- generate_task_code() used the pattern:
--   insert into board_counters (board_id, last_task_number) values (_b, 1)
--   on conflict (board_id)
--     do update set last_task_number = board_counters.last_task_number + 1
--   returning last_task_number;
--
-- For a board with NO counter row but WITH existing "Task N" items, the
-- INSERT branch seeds last_task_number = 1 → returns "Task 1" → which
-- collides with the existing items.Task 1 → 23505. The diagnostic showed
-- multiple boards in this state (Team Projects (Tessera), 3d-5/-6
-- scratch boards, etc.) — likely a result of items being seeded via
-- paths that bypassed the trigger, or counter rows being lost.
--
-- Fix in two parts:
--
-- (a) generate_task_code() now seeds a missing counter row from the
--     ACTUAL max "Task N" already on the board, so the first call is
--     always one above the highest existing code. Idempotent and safe.
--
-- (b) One-shot backfill so every existing board with items >= its
--     counter row is reconciled now — without this the next duplicate
--     on these boards would still hit the same trigger path, the fix
--     makes that path correct but the counter row is still missing/low.
--
-- Strict discipline: only the function + the counter table are touched.
-- No schema change, no RLS change, no items / answers / FK churn.
-- =====================================================================


-- (a) ------------------------------------------------------------------
create or replace function public.generate_task_code(
  _board_id uuid, _parent_item_id uuid
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int;
  v_parent_code text;
  v_seed int;
begin
  if _parent_item_id is null then
    -- Seed for the INSERT branch: one above the highest "Task N"
    -- already on the board. This is what makes the function
    -- self-healing — even if board_counters is missing or stale,
    -- the first call generates a non-colliding code.
    select coalesce(
             max(cast(regexp_replace(task_code, '^Task ', '') as int)),
             0
           ) + 1
      into v_seed
      from public.items
     where board_id = _board_id
       and task_code ~ '^Task [0-9]+$'
       and deleted_at is null;

    insert into public.board_counters (board_id, last_task_number)
    values (_board_id, v_seed)
    on conflict (board_id)
    -- Existing counter: bump by 1, BUT ALSO never let it lag the
    -- actual max (belt-and-braces if items were inserted out-of-band).
    do update set
      last_task_number = greatest(public.board_counters.last_task_number + 1, excluded.last_task_number),
      updated_at = now()
    returning last_task_number into v_n;

    return 'Task ' || v_n;
  end if;

  -- Subitem branch unchanged.
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

comment on function public.generate_task_code(uuid, uuid) is
  '0047: self-healing. When the board has no counter row, seeds last_task_number from max(actual Task N) so duplicate_group / direct inserts can never recycle a code. Subitem branch unchanged.';


-- (b) ------------------------------------------------------------------
-- One-shot backfill. For every board with items, set last_task_number
-- to at least max(existing Task N). Insert a counter row if missing.
with maxes as (
  select board_id,
         coalesce(
           max(cast(regexp_replace(task_code, '^Task ', '') as int)),
           0
         ) as max_n
    from public.items
   where task_code ~ '^Task [0-9]+$'
     and deleted_at is null
   group by board_id
)
insert into public.board_counters (board_id, last_task_number, updated_at)
select board_id, max_n, now()
  from maxes
on conflict (board_id)
do update set
  last_task_number = greatest(public.board_counters.last_task_number, excluded.last_task_number),
  updated_at = now();
