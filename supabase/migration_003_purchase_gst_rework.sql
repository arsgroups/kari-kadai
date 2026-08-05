-- Run this in Supabase SQL Editor. Reworks Purchases: amount entered is now
-- BEFORE GST, with GST added on top (was: amount = total actually paid,
-- GST backed out). Also makes Product/Quantity optional, since Purchase
-- entry no longer requires picking a product.

alter table purchases add column if not exists amount_before_gst numeric;
alter table purchases add column if not exists gst_amount numeric not null default 0;

alter table purchases alter column product_id drop not null;
alter table purchases alter column quantity drop not null;
alter table purchases alter column cost_price drop not null;

-- Backfill: existing rows had total = quantity * cost_price with GST already
-- inside it. We carry that number forward as amount_before_gst so historical
-- totals don't change; gst_amount stays 0 for these since it was never
-- tracked separately before. New rows going forward will have it broken out.
update purchases
set amount_before_gst = coalesce(amount_before_gst, quantity * cost_price)
where amount_before_gst is null;

alter table purchases alter column amount_before_gst set not null;

-- v_supplier_outstanding reads purchases.total, so it must be dropped before
-- we can replace that column, then recreated identically afterward.
drop view if exists v_supplier_outstanding;

alter table purchases drop column total;
alter table purchases add column total numeric generated always as (amount_before_gst + gst_amount) stored;

create or replace view v_supplier_outstanding
  with (security_invoker = true) as
select
  s.id as supplier_id,
  s.name,
  coalesce((select sum(p.total) from purchases p where p.supplier_id = s.id and p.payment_type = 'Credit'), 0)
    - coalesce((select sum(sp.amount) from supplier_payments sp where sp.supplier_id = s.id), 0) as outstanding
from suppliers s;

create or replace function trg_purchase_stock_movement() returns trigger as $$
begin
  if new.product_id is not null and new.quantity is not null then
    insert into stock_movements (date, product_id, movement_type, quantity, reference_type, reference_id)
    values (new.date, new.product_id, 'purchase', abs(new.quantity), 'purchase', new.id);
  end if;
  return new;
end;
$$ language plpgsql;
