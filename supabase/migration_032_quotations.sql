-- Quotation Generator: a customer-facing price quote, separate from Sales
-- Invoices (no tax/inventory impact — quoted prices exclude GST and never
-- touch stock). Channel-scoped item picker with a Listed Price (from the
-- item's channel selling price) and an optional Special Price override.
-- Run this in Supabase SQL Editor.

create sequence if not exists quotation_seq start 1;

create table if not exists quotations (
  id uuid primary key default gen_random_uuid(),
  quotation_number text unique,
  date date not null default current_date,
  channel text not null check (channel in ('Restaurant', 'Home Delivery', 'Counter')),
  customer_name text,
  customer_address text,
  sent_by_name text,
  sent_by_contact text,
  created_at timestamptz not null default now()
);

create or replace function generate_quotation_number() returns trigger as $$
begin
  if new.quotation_number is null then
    new.quotation_number := 'QUO-' || lpad(nextval('quotation_seq')::text, 5, '0');
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_generate_quotation_number on quotations;
create trigger trg_generate_quotation_number
  before insert on quotations
  for each row execute function generate_quotation_number();

create table if not exists quotation_items (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references quotations(id) on delete cascade,
  product_id uuid references products(id),
  display_name text not null,
  unit text,
  listed_price numeric,
  special_price numeric,
  created_at timestamptz not null default now()
);

create index if not exists idx_quotations_date on quotations(date);
create index if not exists idx_quotation_items_quotation on quotation_items(quotation_id);

alter table quotations enable row level security;
drop policy if exists "authenticated_full_access" on quotations;
create policy "authenticated_full_access" on quotations for all to authenticated using (true) with check (true);

alter table quotation_items enable row level security;
drop policy if exists "authenticated_full_access" on quotation_items;
create policy "authenticated_full_access" on quotation_items for all to authenticated using (true) with check (true);
