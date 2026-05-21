-- =====================================================================
-- Monday-night redesign — gently recolor any existing labels that have
-- the canonical Monday status / priority / type names so they match the
-- new chip palette out of the box. Custom-named labels are NOT touched
-- (admins keep whatever colors they chose via LabelsEditorModal).
--
-- This is a one-shot UPDATE; future label creation already uses the new
-- palette via `LabelPicker.tsx` + `LabelsEditorModal.tsx`.
-- =====================================================================

-- Status defaults
update public.column_labels set color = '#F8BD6D' where lower(name) in ('working on it','in progress','active','doing');
update public.column_labels set color = '#787F92' where lower(name) in ('not started','to do','todo','open','new');
update public.column_labels set color = '#D0728A' where lower(name) in ('paused','blocked','stuck','on hold','waiting');
update public.column_labels set color = '#33C481' where lower(name) in ('done','complete','completed','closed');
update public.column_labels set color = '#FF3D8B' where lower(name) in ('urgent','blocker','critical');

-- Priority defaults (purple intensity ramp)
update public.column_labels set color = '#6646A7' where lower(name) in ('high','high priority','p1');
update public.column_labels set color = '#51458F' where lower(name) in ('medium','med','medium priority','p2');
update public.column_labels set color = '#3E3A6B' where lower(name) in ('low','low priority','p3');
