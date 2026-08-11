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
  unit text not null default 'Kg' check (unit in ('Unit', 'Kg', 'Gram')), -- canonical inventory/stock unit
  purchase_unit text not null default 'Kg' check (purchase_unit in ('Unit', 'Kg', 'Gram')),
  sales_unit text not null default 'Kg' check (sales_unit in ('Unit', 'Kg', 'Gram')),
  -- Kg<->Gram converts at 1000; anything involving 'Unit' is 1:1 (see src/lib/units.js)
  purchase_to_inventory_factor numeric not null default 1,
  sales_to_inventory_factor numeric not null default 1,
  default_purchase_price numeric,
  default_selling_price numeric,
  low_stock_threshold numeric not null default 0, -- minimum stock
  opening_stock numeric not null default 0,
  opening_stock_value numeric not null default 0,
  opening_stock_date date,
  is_active boolean not null default true,
  average_cost numeric not null default 0, -- weighted-average cost per inventory unit
  supplier_only boolean not null default false, -- purchase-only item: hidden from every sales channel
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
  movement_type text not null check (movement_type in ('opening','purchase','sale','wastage','adjustment','processing')),
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
  updated_at timestamptz not null default now(),
  unique (customer_id, product_id)
);

create sequence if not exists sale_invoice_seq start 1;

create table if not exists sale_invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text unique,
  date date not null default current_date,
  customer_id uuid references customers(id), -- nullable: Counter sales have no customer
  channel text not null check (channel in ('Restaurant','Home Delivery','Counter')),
  payment_type text not null check (payment_type in ('Cash','Bank','Credit')),
  subtotal numeric not null default 0,
  gst_amount numeric not null default 0,
  total numeric generated always as (subtotal + gst_amount) stored,
  paid_amount numeric not null default 0,
  balance numeric generated always as (subtotal + gst_amount - paid_amount) stored,
  remarks text,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists sale_invoice_items (
  id uuid primary key default gen_random_uuid(),
  sale_invoice_id uuid not null references sale_invoices(id) on delete cascade,
  product_id uuid references products(id),
  quantity numeric not null,
  unit text,
  rate numeric not null,
  discount numeric not null default 0,
  gst_applicable boolean not null default true,
  gst_amount numeric not null default 0,
  amount numeric generated always as (quantity * rate - discount) stored,
  unit_cost numeric, -- product's average_cost snapshotted at time of sale, for margin reporting
  display_name text, -- channel-specific name shown at time of sale (falls back to products.name)
  created_at timestamptz not null default now()
);

create index if not exists idx_sale_invoices_date on sale_invoices(date);
create index if not exists idx_sale_invoices_customer on sale_invoices(customer_id);
create index if not exists idx_sale_invoice_items_invoice on sale_invoice_items(sale_invoice_id);
create index if not exists idx_sale_invoice_items_product on sale_invoice_items(product_id);

create or replace function generate_sale_invoice_number() returns trigger as $$
begin
  if new.invoice_number is null then
    new.invoice_number := 'INV-' || lpad(nextval('sale_invoice_seq')::text, 5, '0');
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_generate_sale_invoice_number on sale_invoices;
create trigger trg_generate_sale_invoice_number
  before insert on sale_invoices
  for each row execute function generate_sale_invoice_number();

create or replace function trg_sale_item_stock_movement() returns trigger as $$
declare
  factor numeric;
  invoice_date date;
begin
  if new.product_id is null then
    return new;
  end if;
  select sales_to_inventory_factor into factor from products where id = new.product_id;
  select date into invoice_date from sale_invoices where id = new.sale_invoice_id;
  insert into stock_movements (date, product_id, movement_type, quantity, reference_type, reference_id)
  values (invoice_date, new.product_id, 'sale', -abs(new.quantity) * coalesce(factor, 1), 'sale', new.id);
  return new;
end;
$$ language plpgsql;

drop trigger if exists sale_item_stock_movement on sale_invoice_items;
create trigger sale_item_stock_movement
  after insert on sale_invoice_items
  for each row execute function trg_sale_item_stock_movement();

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

create sequence if not exists purchase_invoice_seq start 1;

create table if not exists purchase_invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text unique,
  supplier_id uuid not null references suppliers(id),
  date date not null default current_date,
  payment_type text not null check (payment_type in ('Cash','Bank','Credit')),
  subtotal numeric not null default 0,
  gst_amount numeric not null default 0,
  total numeric generated always as (subtotal + gst_amount) stored,
  source text not null default 'manual' check (source in ('manual','imported')),
  import_batch_id uuid references import_batches(id),
  note text,
  created_at timestamptz not null default now()
);

create table if not exists purchase_invoice_items (
  id uuid primary key default gen_random_uuid(),
  purchase_invoice_id uuid not null references purchase_invoices(id) on delete cascade,
  product_id uuid references products(id),
  quantity numeric not null,
  unit text,
  rate numeric not null,
  discount numeric not null default 0,
  gst_applicable boolean not null default true,
  gst_amount numeric not null default 0,
  amount numeric generated always as (quantity * rate - discount) stored,
  created_at timestamptz not null default now()
);

create index if not exists idx_purchase_invoices_date on purchase_invoices(date);
create index if not exists idx_purchase_invoices_supplier on purchase_invoices(supplier_id);
create index if not exists idx_purchase_invoice_items_invoice on purchase_invoice_items(purchase_invoice_id);
create index if not exists idx_purchase_invoice_items_product on purchase_invoice_items(product_id);

create or replace function generate_purchase_invoice_number() returns trigger as $$
begin
  if new.invoice_number is null then
    new.invoice_number := 'PINV-' || lpad(nextval('purchase_invoice_seq')::text, 5, '0');
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_generate_purchase_invoice_number on purchase_invoices;
create trigger trg_generate_purchase_invoice_number
  before insert on purchase_invoices
  for each row execute function generate_purchase_invoice_number();

create or replace function trg_purchase_item_stock_movement() returns trigger as $$
declare
  factor numeric;
  invoice_date date;
begin
  if new.product_id is null then
    return new;
  end if;
  select purchase_to_inventory_factor into factor from products where id = new.product_id;
  select date into invoice_date from purchase_invoices where id = new.purchase_invoice_id;
  insert into stock_movements (date, product_id, movement_type, quantity, reference_type, reference_id)
  values (invoice_date, new.product_id, 'purchase', abs(new.quantity) * coalesce(factor, 1), 'purchase', new.id);
  return new;
end;
$$ language plpgsql;

drop trigger if exists purchase_item_stock_movement on purchase_invoice_items;
create trigger purchase_item_stock_movement
  after insert on purchase_invoice_items
  for each row execute function trg_purchase_item_stock_movement();

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
-- 4. EXPENSES (petty cash + monthly fixed/variable, unified)
-- ============================================================================

create table if not exists expense_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  classification text not null check (classification in ('fixed','variable')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  date date not null default current_date,
  scope text not null default 'daily' check (scope in ('daily', 'monthly')),
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

-- ============================================================================
-- YIELD / PROCESSING: one purchased item cut into multiple sale items
-- (e.g. a whole primal cut broken down into Bone Mutton, Boneless Mutton, ...),
-- with cost allocated by weight from the parent's average cost.
-- ============================================================================

-- A sale item can only belong to one parent's yield configuration — otherwise
-- "which parent do I deduct from?" would be ambiguous.
create table if not exists yield_configurations (
  id uuid primary key default gen_random_uuid(),
  parent_product_id uuid not null references products(id) on delete cascade,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (parent_product_id)
);

create table if not exists yield_configuration_items (
  id uuid primary key default gen_random_uuid(),
  yield_configuration_id uuid not null references yield_configurations(id) on delete cascade,
  child_product_id uuid not null references products(id) unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Per-channel product visibility + display name override. Default (no row):
-- visible in every channel under the item's own name. A row for
-- (product, channel) overrides just that one channel.
create table if not exists product_channel_config (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  channel text not null check (channel in ('Restaurant', 'Home Delivery', 'Counter')),
  display_name text,
  is_visible boolean not null default true,
  created_at timestamptz not null default now(),
  unique (product_id, channel)
);

create or replace function bump_average_cost(p_product_id uuid, p_qty_in numeric, p_unit_cost numeric)
returns void as $$
declare
  old_stock numeric;
  old_avg numeric;
begin
  select coalesce(sum(quantity), 0) into old_stock from stock_movements where product_id = p_product_id;
  select average_cost into old_avg from products where id = p_product_id;

  if old_stock <= 0 then
    update products set average_cost = p_unit_cost where id = p_product_id;
  else
    update products
    set average_cost = ((old_stock * old_avg) + (p_qty_in * p_unit_cost)) / (old_stock + p_qty_in)
    where id = p_product_id;
  end if;
end;
$$ language plpgsql;

create or replace function trg_purchase_item_average_cost() returns trigger as $$
begin
  if new.product_id is not null then
    perform bump_average_cost(new.product_id, abs(new.quantity), new.rate);
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists purchase_item_average_cost on purchase_invoice_items;
create trigger purchase_item_average_cost
  after insert on purchase_invoice_items
  for each row execute function trg_purchase_item_average_cost();

-- Kg<->Gram conversion, mirrors src/lib/units.js conversionFactor().
create or replace function unit_conversion_factor(from_unit text, to_unit text) returns numeric as $$
begin
  if from_unit = to_unit then return 1; end if;
  if from_unit = 'Kg' and to_unit = 'Gram' then return 1000; end if;
  if from_unit = 'Gram' and to_unit = 'Kg' then return 0.001; end if;
  return 1;
end;
$$ language plpgsql immutable;

-- Which parent (if any) a product is a configured yield-child of.
create or replace function yield_parent_of(p_product_id uuid) returns uuid as $$
  select yc.parent_product_id
  from yield_configuration_items yci
  join yield_configurations yc on yc.id = yci.yield_configuration_id
  where yci.child_product_id = p_product_id and yci.is_active = true and yc.is_active = true
  limit 1;
$$ language sql stable;

-- Sales: if the sold product is a configured yield-child (e.g. Mutton
-- Boneless), deduct the equivalent weight from its parent's stock (e.g.
-- Mutton) instead — children never hold independent inventory, so cutting
-- happens implicitly at sale time rather than needing a pre-recorded batch.
create or replace function trg_sale_item_stock_movement() returns trigger as $$
declare
  factor numeric;
  invoice_date date;
  parent_id uuid;
  parent_unit text;
  child_unit text;
  deduct_qty numeric;
  target_id uuid;
begin
  if new.product_id is null then
    return new;
  end if;

  select date into invoice_date from sale_invoices where id = new.sale_invoice_id;
  parent_id := yield_parent_of(new.product_id);

  if parent_id is not null then
    select unit into parent_unit from products where id = parent_id;
    select unit, sales_to_inventory_factor into child_unit, factor from products where id = new.product_id;
    deduct_qty := abs(new.quantity) * coalesce(factor, 1) * unit_conversion_factor(child_unit, parent_unit);
    target_id := parent_id;
  else
    select sales_to_inventory_factor into factor from products where id = new.product_id;
    deduct_qty := abs(new.quantity) * coalesce(factor, 1);
    target_id := new.product_id;
  end if;

  insert into stock_movements (date, product_id, movement_type, quantity, reference_type, reference_id)
  values (invoice_date, target_id, 'sale', -deduct_qty, 'sale', new.id);
  return new;
end;
$$ language plpgsql;

drop trigger if exists sale_item_stock_movement on sale_invoice_items;
create trigger sale_item_stock_movement
  after insert on sale_invoice_items
  for each row execute function trg_sale_item_stock_movement();

-- Margin cost basis: yield-children use their parent's average cost, since
-- children never receive their own stock-in (their own average_cost would
-- otherwise stay 0 forever).
create or replace function trg_sale_item_unit_cost() returns trigger as $$
declare
  parent_id uuid;
begin
  if new.product_id is null then
    return new;
  end if;
  parent_id := yield_parent_of(new.product_id);
  if parent_id is not null then
    select average_cost into new.unit_cost from products where id = parent_id;
  else
    select average_cost into new.unit_cost from products where id = new.product_id;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists sale_item_unit_cost on sale_invoice_items;
create trigger sale_item_unit_cost
  before insert on sale_invoice_items
  for each row execute function trg_sale_item_unit_cost();

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
  coalesce(sum(sm.quantity), 0) as current_stock,
  p.supplier_only
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
  coalesce((select sum(si.balance) from sale_invoices si where si.customer_id = c.id), 0)
    - coalesce((select sum(cp.amount) from customer_payments cp where cp.customer_id = c.id), 0) as outstanding
from customers c;

create or replace view v_supplier_outstanding
  with (security_invoker = true) as
select
  s.id as supplier_id,
  s.name,
  coalesce((select sum(pi.total) from purchase_invoices pi where pi.supplier_id = s.id and pi.payment_type = 'Credit'), 0)
    - coalesce((select sum(sp.amount) from supplier_payments sp where sp.supplier_id = s.id), 0) as outstanding
from suppliers s;

create or replace view v_petty_cash_balance
  with (security_invoker = true) as
select
  coalesce(sum(case when entry_type = 'topup' then amount else 0 end), 0)
    - coalesce(sum(case when entry_type = 'expense' then amount else 0 end), 0) as balance
from expenses
where scope = 'daily';

-- ============================================================================
-- ROW LEVEL SECURITY — any authenticated (logged-in) user has full access
-- ============================================================================

do $$
declare
  t text;
begin
  for t in
    select unnest(array[
      'products','stock_movements','stock_verifications','customers',
      'sale_invoices','sale_invoice_items',
      'customer_payments','suppliers','purchase_invoices','purchase_invoice_items','supplier_payments',
      'manual_accounting_totals','expenses',
      'expense_categories','daily_closing','gst_rate_history',
      'gst_returns','csv_import_mappings','import_batches','customer_item_prices',
      'yield_configurations','yield_configuration_items','product_channel_config'
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
-- USER ROLES ('admin' sees everything; 'sales' has Monthly Expenses, GST,
-- Reports, and Settings hidden/blocked in the app). Not part of the generic
-- RLS loop above — it needs its own policies so only admins can assign roles.
-- ============================================================================

create table if not exists user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'sales' check (role in ('admin', 'sales')),
  created_at timestamptz not null default now()
);

alter table user_roles enable row level security;

drop policy if exists "authenticated_read" on user_roles;
create policy "authenticated_read" on user_roles for select to authenticated using (true);

-- Admin checks go through this security-definer function rather than an
-- inline subquery on user_roles inside its own policy — querying user_roles
-- directly from within a user_roles policy triggers that same policy again,
-- causing "infinite recursion detected in policy" (42P17). A security-definer
-- function runs with its owner's privileges, bypassing RLS for this internal
-- lookup and breaking the cycle.
create or replace function is_admin() returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists (select 1 from user_roles where user_id = auth.uid() and role = 'admin');
$$;

drop policy if exists "admins_write" on user_roles;
create policy "admins_write" on user_roles for all to authenticated
  using (is_admin())
  with check (is_admin());

-- After running this file, mark your own login as admin:
--   insert into user_roles (user_id, role)
--   select id, 'admin' from auth.users where email = 'your-login-email'
--   on conflict (user_id) do update set role = 'admin';

-- Admin-only view of user emails, so Settings can list "who's who" to assign
-- roles against (auth.users isn't otherwise reachable from the app's API).
create or replace view admin_user_directory as
select u.id as user_id, u.email, u.created_at
from auth.users u
where is_admin();

grant select on admin_user_directory to authenticated;

-- ============================================================================
-- SEED DATA
-- ============================================================================

insert into products (name, category, unit, purchase_unit, sales_unit, low_stock_threshold) values
  ('Mutton', 'Mutton', 'Kg', 'Kg', 'Kg', 10),
  ('Mutton Boneless', 'Mutton', 'Kg', 'Kg', 'Kg', 10),
  ('Lamb Boneless', 'Lamb', 'Kg', 'Kg', 'Kg', 10),
  ('Chicken', 'Chicken', 'Kg', 'Kg', 'Kg', 10),
  ('Beef', 'Beef', 'Kg', 'Kg', 'Kg', 10)
on conflict do nothing;

insert into expense_categories (name, classification) values
  ('Salary', 'fixed'),
  ('Rent', 'fixed'),
  ('Incentives', 'variable'),
  ('Fuel', 'variable'),
  ('Transport', 'variable'),
  ('Utilities', 'variable'),
  ('Maintenance', 'variable'),
  ('Refreshments', 'variable'),
  ('Stationery', 'variable'),
  ('CPF', 'variable'),
  ('Levy', 'variable'),
  ('GST Payable', 'variable'),
  ('Miscellaneous', 'variable'),
  ('Others', 'variable')
on conflict (name) do nothing;

insert into gst_rate_history (effective_from, rate_percent, note) values
  ('2024-01-01', 9, 'Singapore standard GST rate from 1 Jan 2024')
on conflict do nothing;
