-- ============================================================================
-- 0037: a saved column layout must not outlive the sheet it was saved for.
--
-- The import remembers which column was which, so a quarterly price list is
-- drag-and-drop the second time. It remembered them as letters — sku is B,
-- Model is E — and applied them to whatever turned up next, in place of the
-- guess, without ever looking at the headers.
--
-- That holds exactly as long as the supplier's sheet keeps its shape. Insert
-- one column and every letter after it points at the wrong thing, and the
-- guess that would have read the new headers correctly is never consulted.
-- What came out was an import that read a Series column as the Size: a
-- hundred and eighteen products all claiming to be size "Dura-Ace", eighty-one
-- of them refused as duplicates of each other, and an error message about
-- duplicate sizes that pointed nowhere near the cause.
--
-- So the headers are saved with the layout. They match, the layout is used;
-- they do not, it is ignored and the columns are read afresh — and the screen
-- says which happened, because a layout silently not being used is its own
-- kind of surprise.
-- ============================================================================

alter table import_templates
  add column if not exists header_labels text[] not null default '{}';

comment on column import_templates.header_labels is
  'The header row this layout was saved against. A sheet whose headers differ '
  'is a different sheet, whatever its columns are called, and the saved '
  'letters no longer describe it.';

-- Every layout saved before this column existed was saved against headers
-- nobody recorded, so none of them can be checked. Emptied rather than
-- trusted: re-guessing a layout costs one glance at a screen, and using a
-- stale one costs an import that looks like it worked.
update import_templates set header_labels = '{}' where header_labels is null;
