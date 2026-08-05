-- Run this in Supabase SQL Editor if you already ran schema.sql before this file existed.
-- (If you're setting up fresh, schema.sql already includes this — no need to run separately.)

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
  insert into stock_movements (date, product_id, movement_type, quantity, reference_type, reference_id)
  values (new.date, new.product_id, 'purchase', abs(new.quantity), 'purchase', new.id);
  return new;
end;
$$ language plpgsql;

drop trigger if exists purchases_stock_movement on purchases;
create trigger purchases_stock_movement
  after insert on purchases
  for each row execute function trg_purchase_stock_movement();
