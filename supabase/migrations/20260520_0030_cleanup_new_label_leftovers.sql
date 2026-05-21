-- =====================================================================
-- Clean up leftover "New label" rows.
--
-- Before the premium picker rewrite, "+ Add label" used to insert a
-- label literally named "New label" with the old default brand color.
-- These accumulated as accidental chips in the grid (the user reported
-- them showing up next to real labels).
--
-- Safe to delete: any column_labels row literally named "New label"
-- that has zero value references in item_column_values (single-select
-- via `label_id` OR multi-select via `label_ids` array element).
-- Labels that some item actually uses are preserved — those have real
-- data behind them.
-- =====================================================================

delete from public.column_labels cl
where lower(cl.name) = 'new label'
  and not exists (
    select 1 from public.item_column_values icv
    where icv.value ->> 'label_id' = cl.id::text
       or icv.value -> 'label_ids' @> to_jsonb(cl.id::text)
  );
