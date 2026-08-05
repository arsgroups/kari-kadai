-- ============================================================================
-- Kari Kadai — Database Schema
-- Run this once in Supabase SQL Editor (Project → SQL Editor → New query)
-- Safe to re-run: uses "if not exists" / "create or replace" where possible.
-- ============================================================================

create extension if not exists pgcrypto;

-- ============================================================================
-- 1. PRODUCTS & STOCK
-- ============================================================================

create sequence if not exists item_code_seq start 1;

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  item_code text unique,
  name text not null,
  category text not null default 'Others',
  description text,
  unit text not null default 'kg', -- canonical inventory/stock unit
  purchase_unit text not null default 'kg',
  sales_unit text not null default 'kg',
  -- how many inventory units are in 1 purchase/sales unit, e.g. 1 Carton = 30 pieces
  purchase_to_inventory_factor numeric not null default 1,
  sales_to_inventory_factor numeric not null default 1,
  default_purchase_price numeric,
  default_selling_price numeric,
  low_stock_threshold numeric not null default 0, -- minimum stock
  opening_stock numeric not null default 0,
  opening_stock_value numeric not null default 0,
  opening_stock_date date,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

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

create table if not exists stock_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  date date not null default current_date,
  movement_type text not null check (movement_type in ('opening','purchase','sale','wastage','adjustment')),
  quantity numeric not null, -- positive = stock in, negative = stock out
  reference_type text check (reference_type in ('sale','purchase','manual')),
  reference_id uuid,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_stock_movements_product on stock_movements(product_id);
create index if not exists idx_stock_movements_date on stock_movements(date);

create table if not exists stock_verifications (
  id uuid primary key default gen_random_uuid(),
  date date not null default current_date,
  product_id uuid not null references products(id) on delete cascade,
  system_qty numeric not null,
  counted_qty numeric not null,
  variance numeric generated always as (counted_qty - system_qty) stored,
  note text,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- 2. CUSTOMERS & SALES
-- ============================================================================

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null check (type in ('Restaurant','Home Delivery')),
  contact text, -- treated as Mobile in the UI
  address text,
  credit_limit numeric,
  credit_days integer,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Per-customer pricing: selecting a customer on an invoice loads these prices,
-- editable per line if needed.
create table if not exists customer_item_prices (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  price numeric not null,
  created_at timestamptz not null default now(),
  unique (customer_id, product_id)
);

create table if not exists sales (
  id uuid primary key default gen_random_uuid(),
  date date not null default current_date,
  product_id uuid not null references products(id),
  quantity numeric not null,
  unit_price numeric not null,
  total numeric generated always as (quantity * unit_price) stored,
  channel text not null check (channel in ('Restaurant','Home Delivery','Counter')),
  customer_id uuid references customers(id),
  payment_type text not null check (payment_type in ('Cash','Bank','Credit')),
  gst_applicable boolean not null default true,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_sales_date on sales(date);
create index if not exists idx_sales_product on sales(product_id);
create index if not exists idx_sales_customer on sales(customer_id);

create table if not exists customer_payments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  date date not null default current_date,
  amount numeric not null,
  payment_type text not null check (payment_type in ('Cash','Bank')),
  note text,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- 3. SUPPLIERS & PURCHASES
-- ============================================================================

create table if not exists suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact text,
  address text,
  phone text,
  gst_registered boolean not null default true,
  credit_days integer,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists csv_import_mappings (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  source_type text not null check (source_type in ('purchases','payables')),
  column_mapping jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists import_batches (
  id uuid primary key default gen_random_uuid(),
  date date not null default current_date,
  source_type text not null,
  file_name text,
  row_count integer,
  mapping_id uuid references csv_import_mappings(id),
  created_at timestamptz not null default now()
);

create table if not exists purchases (
  id uuid primary key default gen_random_uuid(),
  date date not null default current_date,
  supplier_id uuid not null references suppliers(id),
  -- Product/quantity are optional: quick bill entry only needs an amount, but
  -- CSV import (and anyone who wants stock-in tracked) can still supply these.
  product_id uuid references products(id),
  quantity numeric,
  cost_price numeric, -- legacy per-unit field, kept for CSV import compatibility
  amount_before_gst numeric not null,
  gst_amount numeric not null default 0,
  total numeric generated always as (amount_before_gst + gst_amount) stored,
  payment_type text not null check (payment_type in ('Cash','Bank','Credit')),
  source text not null default 'manual' check (source in ('manual','imported')),
  import_batch_id uuid references import_batches(id),
  gst_applicable boolean not null default true,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_purchases_date on purchases(date);
create index if not exists idx_purchases_supplier on purchases(supplier_id);
create index if not exists idx_purchases_product on purchases(product_id);

create table if not exists supplier_payments (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references suppliers(id) on delete cascade,
  date date not null default current_date,
  amount numeric not null,
  payment_type text not null check (payment_type in ('Cash','Bank')),
  note text,
  created_at timestamptz not null default now()
);

create table if not exists manual_accounting_totals (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  period_type text not null check (period_type in ('day','week')),
  total_purchases_amount numeric not null,
  note text,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- 4. PETTY CASH
-- ============================================================================

create table if not exists petty_cash_expense_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists petty_cash_entries (
  id uuid primary key default gen_random_uuid(),
  date date not null default current_date,
  entry_type text not null check (entry_type in ('topup','expense')),
  expense_type_id uuid references petty_cash_expense_types(id),
  amount numeric not null,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_petty_cash_date on petty_cash_entries(date);

-- ============================================================================
-- 5. MONTHLY FIXED & VARIABLE EXPENSES
-- ============================================================================

create table if not exists expense_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  classification text not null check (classification in ('fixed','variable')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists monthly_expenses (
  id uuid primary key default gen_random_uuid(),
  month date not null, -- store as first-of-month
  category_id uuid not null references expense_categories(id),
  amount numeric not null,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_monthly_expenses_month on monthly_expenses(month);

-- ============================================================================
-- 6. DAILY CLOSING
-- ============================================================================

create table if not exists daily_closing (
  id uuid primary key default gen_random_uuid(),
  date date not null unique default current_date,
  actual_cash_counted numeric,
  note text,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- 7. GST (Singapore IRAS — quarterly GST F5 filing aid)
-- ============================================================================

create table if not exists gst_rate_history (
  id uuid primary key default gen_random_uuid(),
  effective_from date not null,
  rate_percent numeric not null,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists gst_returns (
  id uuid primary key default gen_random_uuid(),
  period_start date not null,
  period_end date not null,
  due_date date,
  box1_standard_rated_supplies numeric not null default 0,
  box2_zero_rated_supplies numeric not null default 0,
  box3_exempt_supplies numeric not null default 0,
  box4_total_supplies numeric generated always as
    (box1_standard_rated_supplies + box2_zero_rated_supplies + box3_exempt_supplies) stored,
  total_revenue numeric not null default 0,
  box5_taxable_purchases numeric not null default 0,
  box6_output_tax_due numeric not null default 0,
  box7_input_tax_and_refunds numeric not null default 0,
  box8_net_gst_payable numeric generated always as
    (box6_output_tax_due - box7_input_tax_and_refunds) stored,
  status text not null default 'draft' check (status in ('draft','filed')),
  filed_date date,
  note text,
  created_at timestamptz not null default now(),
  unique (period_start, period_end)
);

-- ============================================================================
-- TRIGGERS — sales/purchases automatically log their own stock movement.
-- This keeps the write atomic (same transaction as the sale/purchase insert)
-- instead of relying on the client to make two separate calls.
-- ============================================================================

create or replace function trg_sale_stock_movement() returns trigger as $$
begin
  insert into stock_movements (date, product_id, movement_type, quantity, reference_type, reference_id)
  values (new.date, new.product_id, 'sale', -abs(new.quantity), 'sale', new.id);
  return new;
end;
$$ language plpgsql;

drop trigger if exists sales_stock_movement on sales;
create trigger sales_stock_movement
  after insert on sales
  for each row execute function trg_sale_stock_movement();

create or replace function trg_purchase_stock_movement() returns trigger as $$
begin
  if new.product_id is not null and new.quantity is not null then
    insert into stock_movements (date, product_id, movement_type, quantity, reference_type, reference_id)
    values (new.date, new.product_id, 'purchase', abs(new.quantity), 'purchase', new.id);
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists purchases_stock_movement on purchases;
create trigger purchases_stock_movement
  after insert on purchases
  for each row execute function trg_purchase_stock_movement();

-- ============================================================================
-- VIEWS (security_invoker so they respect the querying user's RLS)
-- ============================================================================

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

create or replace view v_customer_outstanding
  with (security_invoker = true) as
select
  c.id as customer_id,
  c.name,
  c.type,
  c.credit_limit,
  coalesce((select sum(s.total) from sales s where s.customer_id = c.id and s.payment_type = 'Credit'), 0)
    - coalesce((select sum(cp.amount) from customer_payments cp where cp.customer_id = c.id), 0) as outstanding
from customers c;

create or replace view v_supplier_outstanding
  with (security_invoker = true) as
select
  s.id as supplier_id,
  s.name,
  coalesce((select sum(p.total) from purchases p where p.supplier_id = s.id and p.payment_type = 'Credit'), 0)
    - coalesce((select sum(sp.amount) from supplier_payments sp where sp.supplier_id = s.id), 0) as outstanding
from suppliers s;

create or replace view v_petty_cash_balance
  with (security_invoker = true) as
select
  coalesce(sum(case when entry_type = 'topup' then amount else 0 end), 0)
    - coalesce(sum(case when entry_type = 'expense' then amount else 0 end), 0) as balance
from petty_cash_entries;

-- ============================================================================
-- ROW LEVEL SECURITY — any authenticated (logged-in) user has full access
-- ============================================================================

do $$
declare
  t text;
begin
  for t in
    select unnest(array[
      'products','stock_movements','stock_verifications','customers','sales',
      'customer_payments','suppliers','purchases','supplier_payments',
      'manual_accounting_totals','petty_cash_expense_types','petty_cash_entries',
      'expense_categories','monthly_expenses','daily_closing','gst_rate_history',
      'gst_returns','csv_import_mappings','import_batches','customer_item_prices'
    ])
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "authenticated_full_access" on %I', t);
    execute format(
      'create policy "authenticated_full_access" on %I for all to authenticated using (true) with check (true)',
      t
    );
  end loop;
end $$;

-- ============================================================================
-- SEED DATA
-- ============================================================================

insert into products (name, category, unit, low_stock_threshold) values
  ('Mutton', 'Mutton', 'kg', 10),
  ('Mutton Boneless', 'Mutton', 'kg', 10),
  ('Lamb Boneless', 'Lamb', 'kg', 10),
  ('Chicken', 'Chicken', 'kg', 10),
  ('Beef', 'Beef', 'kg', 10)
on conflict do nothing;

insert into petty_cash_expense_types (name) values
  ('Fuel'), ('Stationery'), ('Tea/Coffee'), ('Others')
on conflict (name) do nothing;

insert into expense_categories (name, classification) values
  ('Salary', 'fixed'),
  ('Rent', 'fixed'),
  ('Incentives', 'variable'),
  ('Fuel', 'variable'),
  ('Refreshments', 'variable'),
  ('CPF', 'variable'),
  ('Levy', 'variable'),
  ('GST Payable', 'variable'),
  ('Others', 'variable')
on conflict (name) do nothing;

insert into gst_rate_history (effective_from, rate_percent, note) values
  ('2024-01-01', 9, 'Singapore standard GST rate from 1 Jan 2024')
on conflict do nothing;
