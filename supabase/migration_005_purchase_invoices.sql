-- V2 Phase 2: Purchase Invoices (multi-line items)
-- Run this in Supabase SQL Editor.
-- Migrates every existing row in `purchases` into its own single-line invoice
-- (reusing the same row id as the new invoice id, so nothing needs generating),
-- then renames the old table to `purchases_legacy` (kept, not dropped) so
-- nothing is lost. New code reads/writes purchase_invoices from here on.

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
  -- Nullable only to accommodate migrating old amount-only purchases that had
  -- no product attached. New invoices entered through the app always require one.
  product_id uuid references products(id),
  quantity numeric not null,
  unit text, -- snapshot of the item's purchase unit at entry time
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

-- Each line item logs its own stock movement, converted from purchase unit to
-- inventory unit via the item's conversion factor. No-ops if product_id is null.
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

alter table purchase_invoices enable row level security;
drop policy if exists "authenticated_full_access" on purchase_invoices;
create policy "authenticated_full_access" on purchase_invoices for all to authenticated using (true) with check (true);

alter table purchase_invoice_items enable row level security;
drop policy if exists "authenticated_full_access" on purchase_invoice_items;
create policy "authenticated_full_access" on purchase_invoice_items for all to authenticated using (true) with check (true);

-- ============================================================================
-- MIGRATE EXISTING DATA (set-based, reusing purchases.id as the new invoice id)
-- ============================================================================

insert into purchase_invoices
  (id, invoice_number, supplier_id, date, payment_type, subtotal, gst_amount, source, import_batch_id, note, created_at)
select id, null, supplier_id, date, payment_type, amount_before_gst, gst_amount, source, import_batch_id, note, created_at
from purchases;

-- Disable the stock-movement trigger just for this backfill: these purchases
-- already logged their stock movement once, back when they were first
-- entered into the old `purchases` table — re-inserting here as line items
-- would otherwise double-count that stock.
alter table purchase_invoice_items disable trigger purchase_item_stock_movement;

insert into purchase_invoice_items
  (purchase_invoice_id, product_id, quantity, unit, rate, gst_applicable, gst_amount, created_at)
select
  p.id,
  p.product_id,
  coalesce(p.quantity, 1),
  prod.purchase_unit,
  case when p.quantity is not null and p.quantity <> 0
    then p.amount_before_gst / p.quantity
    else p.amount_before_gst
  end,
  p.gst_applicable,
  p.gst_amount,
  p.created_at
from purchases p
left join products prod on prod.id = p.product_id;

alter table purchase_invoice_items enable trigger purchase_item_stock_movement;

alter table purchases rename to purchases_legacy;

-- v_supplier_outstanding now reads from purchase_invoices instead of purchases.
create or replace view v_supplier_outstanding
  with (security_invoker = true) as
select
  s.id as supplier_id,
  s.name,
  coalesce((select sum(pi.total) from purchase_invoices pi where pi.supplier_id = s.id and pi.payment_type = 'Credit'), 0)
    - coalesce((select sum(sp.amount) from supplier_payments sp where sp.supplier_id = s.id), 0) as outstanding
from suppliers s;
