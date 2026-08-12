-- Link customer payments to a specific Sale Invoice, so each Credit
-- invoice can show a Paid / Partial / Pending status and take a payment
-- directly from the Sale Invoices list, same as Purchase Invoices.
-- Existing (unlinked) payments are unaffected and keep counting toward
-- the customer's overall outstanding balance via v_customer_outstanding.
-- Run this in Supabase SQL Editor.

alter table customer_payments
  add column if not exists invoice_id uuid references sale_invoices(id) on delete set null;
