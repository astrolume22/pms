-- =====================================================================
-- PMS Phase 4 — Storage bucket + policies for task files.
--
-- Path convention:
--   boards/<board_uuid>/items/<item_uuid>/<file_uuid>-<filename>
-- Or for update attachments:
--   boards/<board_uuid>/updates/<update_uuid>/<file_uuid>-<filename>
--
-- storage.foldername(name) returns the array of folder segments. Index 1
-- is "boards", index 2 is the board uuid.  We use that to gate RLS on
-- the existing can_access_board / can_edit_board helpers.
-- =====================================================================

-- Bucket (private)
insert into storage.buckets (id, name, public)
values ('task-files', 'task-files', false)
on conflict (id) do update set public = excluded.public;

-- Reset policies idempotently
do $$
declare r record;
begin
  for r in
    select policyname from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname like 'task_files_%'
  loop
    execute format('drop policy if exists %I on storage.objects', r.policyname);
  end loop;
end $$;

-- Authenticated users can read any object in 'task-files' that lives
-- under a board they can access.
create policy task_files_select on storage.objects for select
to authenticated
using (
  bucket_id = 'task-files'
  and array_length(storage.foldername(name), 1) >= 2
  and (storage.foldername(name))[1] = 'boards'
  and public.can_access_board(((storage.foldername(name))[2])::uuid)
);

-- Authenticated users can write to a board's prefix iff they can edit it.
create policy task_files_insert on storage.objects for insert
to authenticated
with check (
  bucket_id = 'task-files'
  and array_length(storage.foldername(name), 1) >= 2
  and (storage.foldername(name))[1] = 'boards'
  and public.can_edit_board(((storage.foldername(name))[2])::uuid)
);

-- Updates / deletes: only the original uploader (owner) or admin.
-- Supabase tags the object owner with the inserting user's auth.uid.
create policy task_files_update on storage.objects for update
to authenticated
using (
  bucket_id = 'task-files'
  and (owner = auth.uid() or public.is_admin())
)
with check (
  bucket_id = 'task-files'
  and (owner = auth.uid() or public.is_admin())
);

create policy task_files_delete on storage.objects for delete
to authenticated
using (
  bucket_id = 'task-files'
  and (owner = auth.uid() or public.is_admin())
);
