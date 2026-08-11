-- Purchase-only items: tick "Supplier" on an item and it disappears from
-- every Sales channel dropdown (Restaurant / Home Delivery / Counter),
-- while still showing normally in Purchase Invoice item lists.
-- Run this in Supabase SQL Editor.

alter table products add column if not exists supplier_only boolean not null default false;

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
  p.supplier_only,
  coalesce(sum(sm.quantity), 0) as current_stock
from products p
left join stock_movements sm on sm.product_id = p.id
group by p.id;
