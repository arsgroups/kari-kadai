-- V2 Phase 3: Sales Invoices (multi-line items, GST-exclusive to match Purchases)
-- Run this in Supabase SQL Editor.
-- Migrates every existing row in `sales` into its own single-line invoice
-- (reusing the same row id as the new invoice id), converting the old
-- GST-inclusive total into subtotal + gst_amount using the rate in effect
-- on that sale's date. Old table is renamed to `sales_legacy`, not dropped.

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

alter table sale_invoices enable row level security;
drop policy if exists "authenticated_full_access" on sale_invoices;
create policy "authenticated_full_access" on sale_invoices for all to authenticated using (true) with check (true);

alter table sale_invoice_items enable row level security;
drop policy if exists "authenticated_full_access" on sale_invoice_items;
create policy "authenticated_full_access" on sale_invoice_items for all to authenticated using (true) with check (true);

-- ============================================================================
-- MIGRATE EXISTING DATA (set-based, reusing sales.id as the new invoice id)
-- ============================================================================

insert into sale_invoices
  (id, invoice_number, date, customer_id, channel, payment_type, subtotal, gst_amount, paid_amount, created_at)
select
  s.id,
  null,
  s.date,
  s.customer_id,
  s.channel,
  s.payment_type,
  case when s.gst_applicable and r.rate_percent is not null
    then round(s.total / (1 + r.rate_percent / 100.0), 2)
    else s.total
  end,
  case when s.gst_applicable and r.rate_percent is not null
    then round(s.total - (s.total / (1 + r.rate_percent / 100.0)), 2)
    else 0
  end,
  case when s.payment_type = 'Credit' then 0 else s.total end,
  s.created_at
from sales s
left join lateral (
  select rate_percent from gst_rate_history where effective_from <= s.date order by effective_from desc limit 1
) r on true;

-- Disable the stock-movement trigger just for this backfill: these sales
-- already logged their stock movement once, back when first entered into
-- the old `sales` table — re-inserting here would double-count it.
alter table sale_invoice_items disable trigger sale_item_stock_movement;

insert into sale_invoice_items
  (sale_invoice_id, product_id, quantity, unit, rate, gst_applicable, gst_amount, created_at)
select
  s.id,
  s.product_id,
  s.quantity,
  prod.sales_unit,
  case when s.gst_applicable and r.rate_percent is not null and s.quantity <> 0
    then round((s.total / (1 + r.rate_percent / 100.0)) / s.quantity, 4)
    else s.unit_price
  end,
  s.gst_applicable,
  case when s.gst_applicable and r.rate_percent is not null
    then round(s.total - (s.total / (1 + r.rate_percent / 100.0)), 2)
    else 0
  end,
  s.created_at
from sales s
left join products prod on prod.id = s.product_id
left join lateral (
  select rate_percent from gst_rate_history where effective_from <= s.date order by effective_from desc limit 1
) r on true;

alter table sale_invoice_items enable trigger sale_item_stock_movement;

alter table sales rename to sales_legacy;

-- v_customer_outstanding now reads from sale_invoices instead of sales.
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
