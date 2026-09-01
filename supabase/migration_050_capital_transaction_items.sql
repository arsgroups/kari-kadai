-- Itemized breakdown for a Capital transaction -- "one batch of capital
-- along with the detail". A transaction's overall amount is now always the
-- sum of its detail lines (description + $), the same way a Sale Invoice's
-- total is built from its line items, rather than a manually typed figure
-- that could drift out of sync with its own breakdown.
-- Run this in Supabase SQL Editor.

create table if not exists capital_transaction_items (
  id uuid primary key default gen_random_uuid(),
  capital_transaction_id uuid not null references capital_transactions(id) on delete cascade,
  description text not null,
  amount numeric not null check (amount > 0),
  created_at timestamptz not null default now()
);

create index if not exists idx_capital_transaction_items_transaction on capital_transaction_items(capital_transaction_id);

alter table capital_transaction_items enable row level security;
drop policy if exists "authenticated_full_access" on capital_transaction_items;
create policy "authenticated_full_access" on capital_transaction_items for all to authenticated using (true) with check (true);
