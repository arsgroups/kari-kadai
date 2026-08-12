-- Your database never actually got the unified Expenses table created,
-- even though the app has been querying it since migration_009/011 were
-- written -- Daily Expenses, Monthly Expenses, the Dashboard's expense
-- tiles, and the P&L/Drilldown reports have all been silently reading
-- nothing. This creates it fresh and empty (skipping the old
-- monthly_expenses/petty_cash_entries data-migration step, since you
-- want a clean slate anyway) and points v_petty_cash_balance at it.
-- Run this in Supabase SQL Editor.

insert into expense_categories (name, classification) values
  ('Transport', 'variable'),
  ('Utilities', 'variable'),
  ('Maintenance', 'variable'),
  ('Miscellaneous', 'variable')
on conflict (name) do nothing;

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
  scope text not null default 'daily' check (scope in ('daily', 'monthly')),
  created_at timestamptz not null default now()
);

create index if not exists idx_expenses_date on expenses(date);
create index if not exists idx_expenses_category on expenses(category_id);

alter table expenses enable row level security;
drop policy if exists "authenticated_full_access" on expenses;
create policy "authenticated_full_access" on expenses for all to authenticated using (true) with check (true);

create or replace view v_petty_cash_balance
  with (security_invoker = true) as
select
  coalesce(sum(case when entry_type = 'topup' then amount else 0 end), 0)
    - coalesce(sum(case when entry_type = 'expense' then amount else 0 end), 0) as balance
from expenses
where scope = 'daily';

-- Old V1 tables are no longer read by the app -- rename, don't drop, so
-- nothing is lost if you ever want to look back at them.
alter table if exists monthly_expenses rename to monthly_expenses_legacy;
alter table if exists petty_cash_entries rename to petty_cash_entries_legacy;
alter table if exists petty_cash_expense_types rename to petty_cash_expense_types_legacy;
