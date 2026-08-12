-- Credit sales need a due date (auto-filled from the customer's credit
-- days, editable by the cashier at entry time).
-- Run this in Supabase SQL Editor.

alter table sale_invoices add column if not exists due_date date;
