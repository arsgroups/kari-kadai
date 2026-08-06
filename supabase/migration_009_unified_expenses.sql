-- V2 Enhancement: consolidate Petty Cash + Monthly Expenses into one Expenses module.
-- Run this in Supabase SQL Editor.
-- Old tables are renamed to *_legacy, not dropped — nothing is lost.

-- Ensure the new default categories exist (Fuel and Salary already do).
insert into expense_categories (name, classification) values
  ('Transport', 'variable'),
  ('Utilities', 'variable'),
  ('Maintenance', 'variable'),
  ('Miscellaneous', 'variable')
on conflict (name) do nothing;

-- Bring petty-cash-only categories (Stationery, Tea/Coffee, etc.) into the unified list too.
insert into expense_categories (name, classification)
select t.name, 'variable'
from petty_cash_expense_types t
where not exists (
  select 1 from expense_categories c where lower(c.name) = lower(t.name)
)
on conflict (name) do nothing;

create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  date date not null default current_date,
  entry_type text not null default 'expense' check (entry_type in ('expense', 'topup')),
  category_id uuid references expense_categories(id), -- null for topups
  description text,
  amount numeric not null,
  payment_method text check (payment_method in ('Cash', 'Bank')),
  remarks text,
  created_at timestamptz not null default now()
);

create index if not exists idx_expenses_date on expenses(date);
create index if not exists idx_expenses_category on expenses(category_id);

alter table expenses enable row level security;
drop policy if exists "authenticated_full_access" on expenses;
create policy "authenticated_full_access" on expenses for all to authenticated using (true) with check (true);

-- Migrate monthly_expenses -> expenses (dated on the 1st of that month)
insert into expenses (date, entry_type, category_id, amount, remarks, created_at)
select month, 'expense', category_id, amount, note, created_at
from monthly_expenses;

-- Migrate petty_cash_entries -> expenses, mapping each entry's expense type
-- name to the matching (now-unified) category.
insert into expenses (date, entry_type, category_id, amount, remarks, created_at)
select
  pce.date,
  pce.entry_type,
  case when pce.entry_type = 'expense' then ec.id else null end,
  pce.amount,
  pce.note,
  pce.created_at
from petty_cash_entries pce
left join petty_cash_expense_types pcet on pcet.id = pce.expense_type_id
left join expense_categories ec on lower(ec.name) = lower(pcet.name);

alter table monthly_expenses rename to monthly_expenses_legacy;
alter table petty_cash_entries rename to petty_cash_entries_legacy;
alter table petty_cash_expense_types rename to petty_cash_expense_types_legacy;

-- v_petty_cash_balance now reads from the unified expenses table.
create or replace view v_petty_cash_balance
  with (security_invoker = true) as
select
  coalesce(sum(case when entry_type = 'topup' then amount else 0 end), 0)
    - coalesce(sum(case when entry_type = 'expense' then amount else 0 end), 0) as balance
from expenses;
