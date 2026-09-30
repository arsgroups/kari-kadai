-- Links a product to its (default) supplier -- e.g. Prawns sourced from
-- Yassin Seafood - Geylang. Used by Sales -> Sale Invoice printing to switch
-- to a plain-text "Cash Invoice" header instead of the usual branded banner
-- when any line item on the invoice comes from a specific supplier.
-- Run this in Supabase SQL Editor.

alter table products add column if not exists supplier_id uuid references suppliers(id);
