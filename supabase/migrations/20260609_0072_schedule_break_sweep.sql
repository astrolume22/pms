-- =====================================================================
-- 0072 — Schedule public.shift_break_sweep() to run every minute via
-- pg_cron, so overstayed shift breaks freeze/lock server-side even when
-- the manager is offline / tab closed.
--
-- The RPC itself was shipped + proven idempotent in 0071. This
-- migration ONLY registers the schedule — no function-body change.
--
-- DATA RULES respected:
--   • Strictly additive (one cron entry).
--   • No function changes, no table changes, no policy changes.
--   • Safe to re-run: the unschedule pre-step is wrapped in a DO
--     block that swallows the "job not found" error.
-- =====================================================================
begin;

-- Idempotency: if a 'shift_break_sweep' job already exists, drop it
-- first. cron.unschedule(text) raises if the name is unknown; we
-- swallow that single error so re-running the migration is safe even
-- on the very first apply (when no job exists yet).
do $$
begin
  perform cron.unschedule('shift_break_sweep');
exception when others then
  -- "could not find valid entry for job ..." or similar.
  null;
end $$;

-- Schedule. Schema-qualified inside the command string so the cron
-- worker's search_path doesn't matter. Cron entry "* * * * *" = every
-- minute on the minute (UTC inside pg_cron); the sweep is idempotent
-- so a missed minute or a double-run is harmless.
select cron.schedule(
  'shift_break_sweep',
  '* * * * *',
  $$ select public.shift_break_sweep(); $$
);

commit;
