-- Purchase Item -> Multiple Sale Items (butchery cutting/yield processing).
-- Adds weighted-average cost tracking per product, a configurable parent->child
-- "recipe" (Yield Configuration), and actual Processing Events that consume a
-- parent product's stock and produce stock for its child sale items, with
-- cost allocated by weight and waste tracked as the difference.
-- Run this in Supabase SQL Editor.

alter table products add column if not exists average_cost numeric not null default 0;
alter table sale_invoice_items add column if not exists unit_cost numeric;

-- stock_movements.movement_type didn't previously allow 'processing'.
alter table stock_movements drop constraint if exists stock_movements_movement_type_check;
alter table stock_movements add constraint stock_movements_movement_type_check
  check (movement_type in ('opening', 'purchase', 'sale', 'wastage', 'adjustment', 'processing'));

-- ============================================================================
-- YIELD CONFIGURATION (admin-defined recipe: one parent -> many child items)
-- ============================================================================

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
  child_product_id uuid not null references products(id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (yield_configuration_id, child_product_id)
);

-- ============================================================================
-- PROCESSING EVENTS (an actual cutting/processing batch)
-- ============================================================================

create table if not exists processing_events (
  id uuid primary key default gen_random_uuid(),
  date date not null default current_date,
  parent_product_id uuid not null references products(id),
  quantity_processed numeric not null,
  unit_cost numeric not null, -- parent's average_cost snapshotted at processing time
  note text,
  created_at timestamptz not null default now()
);

create table if not exists processing_event_items (
  id uuid primary key default gen_random_uuid(),
  processing_event_id uuid not null references processing_events(id) on delete cascade,
  child_product_id uuid not null references products(id),
  quantity_yielded numeric not null,
  unit_cost numeric not null, -- = processing_events.unit_cost at the time (by-weight allocation)
  allocated_cost numeric generated always as (quantity_yielded * unit_cost) stored,
  created_at timestamptz not null default now()
);

create index if not exists idx_processing_events_date on processing_events(date);
create index if not exists idx_processing_events_parent on processing_events(parent_product_id);
create index if not exists idx_processing_event_items_event on processing_event_items(processing_event_id);
create index if not exists idx_processing_event_items_child on processing_event_items(child_product_id);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Weighted-average cost update, shared by any stock-in trigger below.
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

-- Purchases: bump the product's average cost using the pre-GST rate, in
-- addition to the existing stock-movement trigger from earlier migrations.
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

-- Processing: deduct the parent's stock for the whole event.
create or replace function trg_processing_event_stock_movement() returns trigger as $$
begin
  insert into stock_movements (date, product_id, movement_type, quantity, reference_type, reference_id, note)
  values (new.date, new.parent_product_id, 'processing', -abs(new.quantity_processed), 'manual', new.id, 'Processed into yield items');
  return new;
end;
$$ language plpgsql;

drop trigger if exists processing_event_stock_movement on processing_events;
create trigger processing_event_stock_movement
  after insert on processing_events
  for each row execute function trg_processing_event_stock_movement();

-- Processing: add stock + bump average cost for each yielded child item.
create or replace function trg_processing_item_stock_movement() returns trigger as $$
declare
  event_date date;
begin
  select date into event_date from processing_events where id = new.processing_event_id;
  perform bump_average_cost(new.child_product_id, new.quantity_yielded, new.unit_cost);
  insert into stock_movements (date, product_id, movement_type, quantity, reference_type, reference_id, note)
  values (event_date, new.child_product_id, 'processing', abs(new.quantity_yielded), 'manual', new.id, 'Yielded from processing');
  return new;
end;
$$ language plpgsql;

drop trigger if exists processing_item_stock_movement on processing_event_items;
create trigger processing_item_stock_movement
  after insert on processing_event_items
  for each row execute function trg_processing_item_stock_movement();

-- Sales: snapshot the product's current average cost onto the sale line, so
-- margin reporting reflects the cost at the time of sale, not today's cost.
create or replace function trg_sale_item_unit_cost() returns trigger as $$
begin
  if new.product_id is not null then
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
-- RLS
-- ============================================================================

do $$
declare
  t text;
begin
  for t in select unnest(array['yield_configurations', 'yield_configuration_items', 'processing_events', 'processing_event_items'])
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "authenticated_full_access" on %I', t);
    execute format('create policy "authenticated_full_access" on %I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;
