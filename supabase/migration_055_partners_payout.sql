-- Partners Payout module: a real, database-backed list of partners and
-- their profit-share percentage (replacing the hardcoded PARTNER_SHARES
-- constant in Reports -> Profit Report), plus a log of actual payouts made
-- against each partner's computed share of a given month's Final Net
-- Profit. Admin-only in the app (see AdminRoute on /partners-payout).
-- Run this in Supabase SQL Editor.

create table if not exists partners (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  share_percent numeric not null check (share_percent >= 0 and share_percent <= 100),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- period is the 'YYYY-MM' month this payout is being made against (the same
-- month picked in Profit Report / Partners Payout) -- nullable for a payout
-- that isn't tied to one specific month (e.g. a catch-up payment).
create table if not exists partner_payouts (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references partners(id) on delete cascade,
  date date not null default current_date,
  amount numeric not null check (amount > 0),
  payment_type text not null check (payment_type in ('Cash','Bank')),
  period text,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_partner_payouts_partner on partner_payouts(partner_id);
create index if not exists idx_partner_payouts_period on partner_payouts(period);

alter table partners enable row level security;
drop policy if exists "authenticated_full_access" on partners;
create policy "authenticated_full_access" on partners for all to authenticated using (true) with check (true);

alter table partner_payouts enable row level security;
drop policy if exists "authenticated_full_access" on partner_payouts;
create policy "authenticated_full_access" on partner_payouts for all to authenticated using (true) with check (true);
