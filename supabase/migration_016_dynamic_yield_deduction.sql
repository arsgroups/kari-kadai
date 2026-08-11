-- Simplifies yield/cutting: removes the manual Processing Event step.
-- Instead, selling a configured child item (e.g. Mutton Boneless) now
-- automatically deducts the equivalent weight from its parent's stock
-- (e.g. Mutton) at the moment of sale — children never hold independent
-- inventory, so nothing needs pre-recording ahead of time.
-- Run this in Supabase SQL Editor.

drop trigger if exists processing_item_stock_movement on processing_event_items;
drop trigger if exists processing_event_stock_movement on processing_events;
drop function if exists trg_processing_item_stock_movement();
drop function if exists trg_processing_event_stock_movement();
drop table if exists processing_event_items;
drop table if exists processing_events;

-- A sale item can only be configured as a child of one parent — otherwise
-- "which parent do I deduct from?" would be ambiguous.
alter table yield_configuration_items drop constraint if exists yield_configuration_items_child_product_id_key;
alter table yield_configuration_items add constraint yield_configuration_items_child_product_id_key unique (child_product_id);

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

-- Sales: deduct from the parent's stock (unit-converted) when the sold
-- product is a configured yield-child; otherwise behaves exactly as before.
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
