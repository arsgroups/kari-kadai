-- Split Expenses into Daily vs Monthly scope, so access can later be
-- restricted (staff: daily only; management: everything) without another
-- schema change — this migration only adds the marker column, it doesn't
-- add any permission enforcement yet.
-- Run this in Supabase SQL Editor.

alter table expenses add column if not exists scope text not null default 'daily' check (scope in ('daily', 'monthly'));

-- Backfill existing rows: fixed-classified categories (Salary, Rent, CPF, ...)
-- are treated as monthly; everything else (variable categories, and topups,
-- which have no category) stays daily. Adjust individual rows afterward in
-- the app if any don't match your actual intent.
update expenses e
set scope = 'monthly'
from expense_categories c
where e.category_id = c.id and c.classification = 'fixed' and e.scope = 'daily';

-- Petty cash balance is a daily-till concept — recurring monthly bills
-- shouldn't be netted against it.
create or replace view v_petty_cash_balance
  with (security_invoker = true) as
select
  coalesce(sum(case when entry_type = 'topup' then amount else 0 end), 0)
    - coalesce(sum(case when entry_type = 'expense' then amount else 0 end), 0) as balance
from expenses
where scope = 'daily';
