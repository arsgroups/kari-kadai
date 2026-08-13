-- Fixes a leftover bug from migration_016: it tried to drop the old
-- composite unique constraint from yield_configuration_items by guessing
-- its name as "yield_configuration_items_child_product_id_key", but
-- Postgres had actually auto-named it
-- "yield_configuration_items_yield_configuration_id_child_prod_key"
-- (from `unique (yield_configuration_id, child_product_id)` in
-- migration_015). The DROP silently no-op'd (IF EXISTS), so the old
-- composite constraint was never removed -- it's still sitting alongside
-- the correct single-column constraint added right after it, and firing
-- a confusing "duplicate key" error whenever you try to re-save a child
-- item under the same parent (e.g. editing its channel/price settings).
-- Run this in Supabase SQL Editor.

alter table yield_configuration_items
  drop constraint if exists yield_configuration_items_yield_configuration_id_child_prod_key;
