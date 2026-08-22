-- Since any user can now edit a saved Sale Invoice (adjust qty/price), log
-- those edits to the Audit Log too, not just create/delete.
-- Run this in Supabase SQL Editor.

drop trigger if exists audit_sale_invoices on sale_invoices;
create trigger audit_sale_invoices after insert or update or delete on sale_invoices
  for each row execute function log_audit_event('Sale Invoice');
