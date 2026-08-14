-- Removes the "Import from Accounting App" feature (CSV import, manual
-- monthly-total entry) and its tables. Nothing else in the app reads these.
-- Run this in Supabase SQL Editor.

alter table purchase_invoices drop column if exists import_batch_id;
alter table if exists purchases_legacy drop column if exists import_batch_id;

drop table if exists import_batches;
drop table if exists csv_import_mappings;
drop table if exists manual_accounting_totals;
