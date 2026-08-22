-- Sales Return: record goods a customer returns against an existing Sale
-- Invoice. Restocks the returned quantity and reduces that invoice's
-- subtotal/gst_amount (and therefore its total/balance), while keeping a
-- full return trail separate from the original invoice for audit purposes.
-- Run this in Supabase SQL Editor.

create sequence if not exists sale_return_seq start 1;

create table if not exists sale_returns (
  id uuid primary key default gen_random_uuid(),
  return_number text unique,
  sale_invoice_id uuid not null references sale_invoices(id),
  date date not null default current_date,
  reason text,
  subtotal numeric not null default 0,
  gst_amount numeric not null default 0,
  total numeric generated always as (subtotal + gst_amount) stored,
  created_at timestamptz not null default now()
);

create table if not exists sale_return_items (
  id uuid primary key default gen_random_uuid(),
  sale_return_id uuid not null references sale_returns(id) on delete cascade,
  sale_invoice_item_id uuid references sale_invoice_items(id),
  product_id uuid references products(id),
  quantity numeric not null,
  unit text,
  rate numeric not null,
  gst_applicable boolean not null default false,
  gst_amount numeric not null default 0,
  amount numeric generated always as (quantity * rate) stored,
  created_at timestamptz not null default now()
);

create index if not exists idx_sale_returns_invoice on sale_returns(sale_invoice_id);
create index if not exists idx_sale_return_items_return on sale_return_items(sale_return_id);
create index if not exists idx_sale_return_items_invoice_item on sale_return_items(sale_invoice_item_id);

create or replace function generate_sale_return_number() returns trigger as $$
begin
  if new.return_number is null then
    new.return_number := 'SR-' || lpad(nextval('sale_return_seq')::text, 5, '0');
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_generate_sale_return_number on sale_returns;
create trigger trg_generate_sale_return_number
  before insert on sale_returns
  for each row execute function generate_sale_return_number();

-- Restocks the returned quantity. The parent invoice's subtotal/gst_amount
-- are adjusted separately by the app (it recomputes the Restaurant 9%
-- surcharge on the reduced subtotal the same way it's computed at entry,
-- rather than trying to prorate it per line here).
create or replace function trg_sale_return_item_effects() returns trigger as $$
declare
  factor numeric;
  return_date date;
begin
  if new.product_id is not null then
    select date into return_date from sale_returns where id = new.sale_return_id;
    select sales_to_inventory_factor into factor from products where id = new.product_id;
    insert into stock_movements (date, product_id, movement_type, quantity, reference_type, reference_id)
    values (return_date, new.product_id, 'sales_return', abs(new.quantity) * coalesce(factor, 1), 'sales_return', new.id);
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists sale_return_item_effects on sale_return_items;
create trigger sale_return_item_effects
  after insert on sale_return_items
  for each row execute function trg_sale_return_item_effects();

alter table sale_returns enable row level security;
drop policy if exists "authenticated_full_access" on sale_returns;
create policy "authenticated_full_access" on sale_returns for all to authenticated using (true) with check (true);

alter table sale_return_items enable row level security;
drop policy if exists "authenticated_full_access" on sale_return_items;
create policy "authenticated_full_access" on sale_return_items for all to authenticated using (true) with check (true);
