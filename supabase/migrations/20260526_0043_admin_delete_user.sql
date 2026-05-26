-- =====================================================================
-- 0043 — admin_delete_user + SET NULL on user-authorship FKs.
--
-- Goal: an admin can permanently delete a user (kills the login,
-- removes the public.users + auth.users rows) WITHOUT destroying any
-- content that user authored. Their boards, tasks, comments, views,
-- files, invites they minted, AI runs, and audit-trail rows all
-- survive with the author column = NULL.
--
-- The DATA OWNERSHIP RULE — SET NULL never CASCADE on user FKs that
-- carry AUTHORSHIP of shared content.
--
-- ============== FK FLIPS ===========================================
-- Diagnose-step inventory (live as of pre-migration):
--
--   Content authorship — to flip:
--     boards.created_by            RESTRICT -> SET NULL
--     boards.owner_id              RESTRICT -> SET NULL
--     items.created_by             RESTRICT -> SET NULL
--     updates.author_id            RESTRICT -> SET NULL
--     views.created_by             RESTRICT -> SET NULL
--     files.uploader_id            RESTRICT -> SET NULL
--     invites.created_by           CASCADE  -> SET NULL
--     activity_log.actor_id        CASCADE  -> SET NULL  (preserve audit)
--     ai_runs.user_id              CASCADE  -> SET NULL  (preserve AI usage)
--
--   Already SET NULL (no change):
--     items.updated_by, item_column_values.updated_by,
--     invites.used_by, notifications.actor_id
--
--   Per-user pivot / personal state — INTENTIONALLY left CASCADE
--   (these are NOT content, the user_id is part of the row identity,
--   SET NULL is structurally invalid or semantically meaningless):
--     board_subscribers, workspace_members, item_subscribers,
--     board_favorites, board_last_viewed, notifications.recipient_id,
--     update_mentions.mentioned_user_id, update_reactions.user_id
--
--   auth.* FKs — Supabase-owned, left CASCADE as intended.
--   public.users.id -> auth.users.id is also CASCADE (the bridge).
--
-- ============== admin_delete_user ==================================
-- SECURITY DEFINER, admin-only (is_admin()). Refuses:
--   - self-delete (auth.uid() = p_user_id)
--   - deleting the last active admin
--   - deleting a super admin (is_super_admin=true)
-- Deletes public.users FIRST (so SET NULL fires on the 9 authorship
-- FKs + CASCADE clears pivot rows + the bridge FK on auth.users is
-- still satisfied), then deletes auth.users (kills the login,
-- cascades Supabase's internal session/identity rows).
-- =====================================================================


-- ---------------------------------------------------------------------
-- (1) Flip authorship FKs to ON DELETE SET NULL.
-- ---------------------------------------------------------------------

-- Each block: drop the old FK, recreate with the right ON DELETE.
-- Column nullability is preserved (these columns are already nullable
-- or about to be — see assertions inline).

-- boards.created_by  (currently RESTRICT)
alter table public.boards drop constraint if exists boards_created_by_fk;
alter table public.boards alter column created_by drop not null;
alter table public.boards
  add constraint boards_created_by_fk
  foreign key (created_by) references public.users(id)
  on update no action on delete set null;

-- boards.owner_id  (currently RESTRICT)
alter table public.boards drop constraint if exists boards_owner_fk;
alter table public.boards alter column owner_id drop not null;
alter table public.boards
  add constraint boards_owner_fk
  foreign key (owner_id) references public.users(id)
  on update no action on delete set null;

-- items.created_by  (currently RESTRICT)
alter table public.items drop constraint if exists items_created_by_fk;
alter table public.items alter column created_by drop not null;
alter table public.items
  add constraint items_created_by_fk
  foreign key (created_by) references public.users(id)
  on update no action on delete set null;

-- updates.author_id  (currently RESTRICT)
alter table public.updates drop constraint if exists updates_author_fk;
alter table public.updates alter column author_id drop not null;
alter table public.updates
  add constraint updates_author_fk
  foreign key (author_id) references public.users(id)
  on update no action on delete set null;

-- views.created_by  (currently RESTRICT)
alter table public.views drop constraint if exists views_created_by_fk;
alter table public.views alter column created_by drop not null;
alter table public.views
  add constraint views_created_by_fk
  foreign key (created_by) references public.users(id)
  on update no action on delete set null;

-- files.uploader_id  (currently RESTRICT)
alter table public.files drop constraint if exists files_uploader_fk;
alter table public.files alter column uploader_id drop not null;
alter table public.files
  add constraint files_uploader_fk
  foreign key (uploader_id) references public.users(id)
  on update no action on delete set null;

-- invites.created_by  (currently CASCADE)
alter table public.invites drop constraint if exists invites_created_by_fk;
alter table public.invites alter column created_by drop not null;
alter table public.invites
  add constraint invites_created_by_fk
  foreign key (created_by) references public.users(id)
  on update no action on delete set null;

-- activity_log.actor_id  (currently CASCADE)
alter table public.activity_log drop constraint if exists activity_log_actor_fk;
alter table public.activity_log alter column actor_id drop not null;
alter table public.activity_log
  add constraint activity_log_actor_fk
  foreign key (actor_id) references public.users(id)
  on update no action on delete set null;

-- ai_runs.user_id  (currently CASCADE)
alter table public.ai_runs drop constraint if exists ai_runs_user_fk;
alter table public.ai_runs alter column user_id drop not null;
alter table public.ai_runs
  add constraint ai_runs_user_fk
  foreign key (user_id) references public.users(id)
  on update no action on delete set null;


-- ---------------------------------------------------------------------
-- (2) admin_delete_user RPC.
-- ---------------------------------------------------------------------
create or replace function public.admin_delete_user(p_user_id uuid)
returns void
language plpgsql security definer set search_path = public, auth as $$
declare
  v_target          record;
  v_remaining_admins int;
begin
  -- Admin gate
  if not public.is_admin() then
    raise exception 'Only admins can delete users' using errcode='42501';
  end if;

  -- Self-delete guard
  if auth.uid() = p_user_id then
    raise exception 'Cannot delete your own account' using errcode='42501';
  end if;

  -- Load target
  select id, username, role, status, is_super_admin
    into v_target
    from public.users
   where id = p_user_id;
  if not found then
    raise exception 'User not found' using errcode='22023';
  end if;

  -- Super-admin guard (cannot be nuked via this RPC)
  if v_target.is_super_admin then
    raise exception 'Cannot delete a super admin' using errcode='42501';
  end if;

  -- Last-admin guard — only relevant if the target is an admin.
  -- We require at least ONE other admin to remain active.
  if v_target.role = 'admin' then
    select count(*)
      into v_remaining_admins
      from public.users
     where role = 'admin'
       and status = 'active'
       and id <> p_user_id;
    if v_remaining_admins = 0 then
      raise exception 'Cannot delete the last admin' using errcode='42501';
    end if;
  end if;

  -- Delete public.users FIRST so the SET-NULL authorship FKs fire +
  -- pivot/preference rows cascade away cleanly. The bridge FK
  -- (public.users.id -> auth.users.id, ON DELETE CASCADE) does NOT
  -- fire here because we're deleting the dependent side first.
  delete from public.users where id = p_user_id;

  -- Now nuke the auth row to kill the login. Supabase's internal
  -- auth.* tables (sessions, identities, mfa, etc.) cascade with it.
  delete from auth.users where id = p_user_id;
end;
$$;

revoke all on function public.admin_delete_user(uuid) from public;
grant execute on function public.admin_delete_user(uuid) to authenticated;

comment on function public.admin_delete_user(uuid) is
  '0043: admin-only permanent user delete. Refuses self-delete, last-admin, and super admin. Deletes public.users + auth.users. Authorship FKs (boards/items/updates/views/files/invites.created_by, activity_log.actor_id, ai_runs.user_id, etc.) are SET NULL so the user''s content survives with null author. Per-user pivot rows (subscriptions, favorites, notifications addressed to them) cascade away with the user as intended.';
