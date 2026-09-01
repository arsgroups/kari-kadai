-- Month-End Management & P&L Report -- new data needed:
--   1. capital_transactions -- partner contributions/withdrawals, never
--      mixed with operating income/expense.
--   2. expense_categories.is_fixed_asset -- marks a category as Fixed
--      Asset/Capex (Billing Software, Furniture, Aircon, ...) so those
--      expenses are excluded from Operating Expenses (and therefore from
--      the Managing Partner Fee base) everywhere, not just the new report.
--   3. partner_fee_rate_history -- configurable Managing Partner Fee %,
--      date-effective, mirrors gst_rate_history's pattern exactly.
-- Run this in Supabase SQL Editor.

create table if not exists capital_transactions (
  id uuid primary key default gen_random_uuid(),
  date date not null default current_date,
  partner_name text not null,
  transaction_type text not null check (transaction_type in ('contribution', 'withdrawal')),
  amount numeric not null check (amount > 0),
  description text,
  reference text,
  created_at timestamptz not null default now()
);

create index if not exists idx_capital_transactions_date on capital_transactions(date);

alter table capital_transactions enable row level security;
drop policy if exists "authenticated_full_access" on capital_transactions;
create policy "authenticated_full_access" on capital_transactions for all to authenticated using (true) with check (true);

alter table expense_categories add column if not exists is_fixed_asset boolean not null default false;

update expense_categories set is_fixed_asset = true
where name in ('Billing Software', 'Inventory Software', 'Website Design', 'Furniture', 'Aircon', 'Equipment', 'Computers');

insert into expense_categories (name, classification, is_fixed_asset) values
  ('Billing Software', 'fixed', true),
  ('Inventory Software', 'fixed', true),
  ('Website Design', 'fixed', true),
  ('Furniture', 'fixed', true),
  ('Aircon', 'fixed', true),
  ('Equipment', 'fixed', true),
  ('Computers', 'fixed', true)
on conflict (name) do update set is_fixed_asset = true;

create table if not exists partner_fee_rate_history (
  id uuid primary key default gen_random_uuid(),
  effective_from date not null,
  rate_percent numeric not null,
  note text,
  created_at timestamptz not null default now()
);

alter table partner_fee_rate_history enable row level security;
drop policy if exists "authenticated_full_access" on partner_fee_rate_history;
create policy "authenticated_full_access" on partner_fee_rate_history for all to authenticated using (true) with check (true);

insert into partner_fee_rate_history (effective_from, rate_percent, note)
select '2024-01-01', 10, 'Default Managing Partner Fee'
where not exists (select 1 from partner_fee_rate_history);
