-- Adds a customer contact field to quotations, shown alongside the
-- customer name/address in place of the shop name at the top of the
-- printed quotation.
-- Run this in Supabase SQL Editor.

alter table quotations add column if not exists customer_contact text;
