-- Buy X Get Y Free promotions: let the free item differ from the item
-- being bought (previously the free unit was always the same product).
-- Nullable so existing promotions keep working -- the app falls back to
-- product_id (the "buy" item) when free_product_id isn't set.
-- Run this in Supabase SQL Editor.

alter table promotions add column if not exists free_product_id uuid references products(id);
