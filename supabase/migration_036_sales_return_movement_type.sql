-- migration_035's restock trigger inserts movement_type/reference_type =
-- 'sales_return', which the existing check constraints didn't allow yet.
-- Run this in Supabase SQL Editor (after migration_035).

alter table stock_movements drop constraint if exists stock_movements_movement_type_check;
alter table stock_movements add constraint stock_movements_movement_type_check
  check (movement_type in ('opening','purchase','sale','wastage','adjustment','processing','sales_return'));

alter table stock_movements drop constraint if exists stock_movements_reference_type_check;
alter table stock_movements add constraint stock_movements_reference_type_check
  check (reference_type in ('sale','purchase','manual','sales_return'));
