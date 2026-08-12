-- Link supplier payments to a specific Purchase Invoice, so each invoice
-- can show a Paid / Partial / Pending status and take a payment directly
-- from the Purchase Invoices list. Existing (unlinked) payments are
-- unaffected and keep counting toward the supplier's overall outstanding
-- balance via v_supplier_outstanding.
-- Run this in Supabase SQL Editor.

alter table supplier_payments
  add column if not exists invoice_id uuid references purchase_invoices(id) on delete set null;
