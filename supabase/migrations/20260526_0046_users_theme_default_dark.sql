-- =====================================================================
-- 0046 — flip public.users.theme column default to 'dark'.
--
-- The app is now dark-first (see src/state/themeStore.ts). New users
-- created via the invite-accept flow or admin_create_user inherit the
-- column default, so without this flip they'd be seeded as 'light' and
-- the in-app theme would mismatch the visual brand on first login.
--
-- Existing rows are NOT touched — per the product spec, "respect an
-- explicit user choice". We can't tell whether a current 'light' row
-- reflects an explicit setting or just the old default, so we treat
-- both as the user's preference and leave them alone.
--
-- Strictly additive: no schema change beyond ALTER COLUMN ... SET DEFAULT.
-- The NOT NULL constraint stays. No RLS, no FK changes.
-- =====================================================================

alter table public.users
  alter column theme set default 'dark';

comment on column public.users.theme is
  '0046: default changed from ''light'' to ''dark''. Existing rows untouched (respect explicit user choices).';
