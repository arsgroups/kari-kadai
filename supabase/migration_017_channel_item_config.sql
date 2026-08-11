-- Per-channel product visibility + display name override.
-- Default (no row): visible in every channel under the item's own name.
-- A row for (product, channel) overrides just that one channel — it never
-- affects the other channels for that same product.
-- Run this in Supabase SQL Editor.

create table if not exists product_channel_config (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  channel text not null check (channel in ('Restaurant', 'Home Delivery', 'Counter')),
  display_name text, -- null = use the product's own name
  is_visible boolean not null default true,
  created_at timestamptz not null default now(),
  unique (product_id, channel)
);

alter table product_channel_config enable row level security;
drop policy if exists "authenticated_full_access" on product_channel_config;
create policy "authenticated_full_access" on product_channel_config for all to authenticated using (true) with check (true);

-- Snapshot of the channel-specific name shown at time of sale, so the
-- customer-facing invoice reflects what they were actually offered (e.g.
-- "Fresh Goat/Lamb" on a Counter sale) even if the config changes later.
alter table sale_invoice_items add column if not exists display_name text;
