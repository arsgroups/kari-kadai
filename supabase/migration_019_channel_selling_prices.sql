-- Per-channel default selling prices: set once on the item, and the Sales
-- invoice pre-fills the price based on the channel selected (still editable
-- by the cashier per line). Falls back to Default Selling Price if a
-- channel-specific price isn't set.
-- Run this in Supabase SQL Editor.

alter table products add column if not exists restaurant_price numeric;
alter table products add column if not exists counter_price numeric;
