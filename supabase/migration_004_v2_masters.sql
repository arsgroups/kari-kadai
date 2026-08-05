-- V2 Phase 1: Item Master, Customer Master, Supplier Master, Customer Pricing
-- Run this in Supabase SQL Editor.

-- ============================================================================
-- ITEM MASTER (products table gets richer)
-- ============================================================================

create sequence if not exists item_code_seq start 1;

alter table products add column if not exists item_code text;
alter table products add column if not exists description text;
-- "unit" (existing column) remains the canonical inventory/stock unit.
alter table products add column if not exists purchase_unit text;
alter table products add column if not exists sales_unit text;
-- How many inventory units are in 1 purchase/sales unit, e.g. 1 Carton = 30 pieces.
alter table products add column if not exists purchase_to_inventory_factor numeric not null default 1;
alter table products add column if not exists sales_to_inventory_factor numeric not null default 1;
alter table products add column if not exists default_purchase_price numeric;
alter table products add column if not exists default_selling_price numeric;
alter table products add column if not exists opening_stock numeric not null default 0;
alter table products add column if not exists opening_stock_value numeric not null default 0;
alter table products add column if not exists opening_stock_date date;

update products set purchase_unit = coalesce(purchase_unit, unit) where purchase_unit is null;
update products set sales_unit = coalesce(sales_unit, unit) where sales_unit is null;

alter table products alter column purchase_unit set not null;
alter table products alter column sales_unit set not null;

-- Backfill item codes for any existing rows, then make it required + unique going forward.
do $$
declare
  r record;
begin
  for r in select id from products where item_code is null order by created_at loop
    update products set item_code = 'ITM-' || lpad(nextval('item_code_seq')::text, 4, '0') where id = r.id;
  end loop;
end $$;

alter table products alter column item_code set not null;
create unique index if not exists idx_products_item_code on products(item_code);

create or replace function generate_item_code() returns trigger as $$
begin
  if new.item_code is null then
    new.item_code := 'ITM-' || lpad(nextval('item_code_seq')::text, 4, '0');
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_generate_item_code on products;
create trigger trg_generate_item_code
  before insert on products
  for each row execute function generate_item_code();

-- Opening stock convenience: if set on the item, log it as a stock movement too,
-- so "current stock" (ledger-derived) matches what was declared here.
create or replace function trg_product_opening_stock() returns trigger as $$
begin
  if new.opening_stock is not null and new.opening_stock <> 0 then
    insert into stock_movements (date, product_id, movement_type, quantity, reference_type, note)
    values (coalesce(new.opening_stock_date, current_date), new.id, 'opening', new.opening_stock, 'manual', 'Opening stock from Item Master');
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists product_opening_stock on products;
create trigger product_opening_stock
  after insert on products
  for each row execute function trg_product_opening_stock();

create or replace view v_current_stock
  with (security_invoker = true) as
select
  p.id as product_id,
  p.item_code,
  p.name,
  p.category,
  p.unit,
  p.purchase_unit,
  p.sales_unit,
  p.low_stock_threshold,
  p.is_active,
  coalesce(sum(sm.quantity), 0) as current_stock
from products p
left join stock_movements sm on sm.product_id = p.id
group by p.id;

-- ============================================================================
-- CUSTOMER MASTER additions
-- ============================================================================

alter table customers add column if not exists address text;
alter table customers add column if not exists credit_days integer;
-- "contact" (existing column) is treated as Mobile in the UI going forward.

-- ============================================================================
-- CUSTOMER-SPECIFIC PRICING
-- ============================================================================

create table if not exists customer_item_prices (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  price numeric not null,
  created_at timestamptz not null default now(),
  unique (customer_id, product_id)
);

alter table customer_item_prices enable row level security;
drop policy if exists "authenticated_full_access" on customer_item_prices;
create policy "authenticated_full_access" on customer_item_prices for all to authenticated using (true) with check (true);

-- ============================================================================
-- SUPPLIER MASTER additions
-- ============================================================================

alter table suppliers add column if not exists address text;
alter table suppliers add column if not exists phone text;
alter table suppliers add column if not exists credit_days integer;
