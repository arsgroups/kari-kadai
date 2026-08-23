-- Make the Restaurant channel's 9% surcharge opt-out per customer (default)
-- and per invoice (overridable at entry time). Both default true, so every
-- existing customer/invoice keeps behaving exactly as before.
-- Run this in Supabase SQL Editor.

alter table customers add column if not exists surcharge_applicable boolean not null default true;
alter table sale_invoices add column if not exists surcharge_applicable boolean not null default true;
