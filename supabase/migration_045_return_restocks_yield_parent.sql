-- Fixes Sales Return restocking a yield-child directly. Children never hold
-- their own stock (available stock is always derived from the parent, same
-- as how a sale deducts from the parent) -- so a return of a child item must
-- restock the PARENT, converted through the yield/unit ratio, exactly
-- mirroring how the original sale deducted it. Previously the return
-- restocked the child's own product_id, which is invisible to inventory
-- since children never have their own tracked stock.
-- Run this in Supabase SQL Editor.

create or replace function trg_sale_return_item_effects() returns trigger as $$
declare
  factor numeric;
  return_date date;
  parent_id uuid;
  parent_unit text;
  child_unit text;
  restock_qty numeric;
  target_id uuid;
begin
  if new.product_id is null then
    return new;
  end if;

  select date into return_date from sale_returns where id = new.sale_return_id;
  parent_id := yield_parent_of(new.product_id);

  if parent_id is not null then
    select unit into parent_unit from products where id = parent_id;
    select unit, sales_to_inventory_factor into child_unit, factor from products where id = new.product_id;
    restock_qty := abs(new.quantity) * coalesce(factor, 1) * unit_conversion_factor(child_unit, parent_unit);
    target_id := parent_id;
  else
    select sales_to_inventory_factor into factor from products where id = new.product_id;
    restock_qty := abs(new.quantity) * coalesce(factor, 1);
    target_id := new.product_id;
  end if;

  insert into stock_movements (date, product_id, movement_type, quantity, reference_type, reference_id)
  values (return_date, target_id, 'sales_return', restock_qty, 'sales_return', new.id);
  return new;
end;
$$ language plpgsql;
