-- V2 Enhancement: fixed selling-unit set (Unit / Kg / Gram) instead of free text.
-- Run this in Supabase SQL Editor.

-- Normalize existing values to the canonical set, most-specific match first.
update products set unit = 'Kg' where lower(unit) in ('kg', 'kilogram', 'kilograms');
update products set unit = 'Gram' where lower(unit) in ('g', 'gram', 'grams');
update products set unit = 'Unit' where unit not in ('Kg', 'Gram');

update products set purchase_unit = 'Kg' where lower(purchase_unit) in ('kg', 'kilogram', 'kilograms');
update products set purchase_unit = 'Gram' where lower(purchase_unit) in ('g', 'gram', 'grams');
update products set purchase_unit = unit where purchase_unit is null or purchase_unit not in ('Kg', 'Gram', 'Unit');

update products set sales_unit = 'Kg' where lower(sales_unit) in ('kg', 'kilogram', 'kilograms');
update products set sales_unit = 'Gram' where lower(sales_unit) in ('g', 'gram', 'grams');
update products set sales_unit = unit where sales_unit is null or sales_unit not in ('Kg', 'Gram', 'Unit');

-- Recompute conversion factors deterministically now that units are normalized
-- (Kg<->Gram is exactly 1000; anything involving 'Unit' is 1:1).
update products set purchase_to_inventory_factor = case
  when purchase_unit = unit then 1
  when purchase_unit = 'Kg' and unit = 'Gram' then 1000
  when purchase_unit = 'Gram' and unit = 'Kg' then 0.001
  else 1
end;

update products set sales_to_inventory_factor = case
  when sales_unit = unit then 1
  when sales_unit = 'Kg' and unit = 'Gram' then 1000
  when sales_unit = 'Gram' and unit = 'Kg' then 0.001
  else 1
end;

alter table products drop constraint if exists products_unit_check;
alter table products add constraint products_unit_check check (unit in ('Unit', 'Kg', 'Gram'));

alter table products drop constraint if exists products_purchase_unit_check;
alter table products add constraint products_purchase_unit_check check (purchase_unit in ('Unit', 'Kg', 'Gram'));

alter table products drop constraint if exists products_sales_unit_check;
alter table products add constraint products_sales_unit_check check (sales_unit in ('Unit', 'Kg', 'Gram'));
