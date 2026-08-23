-- Buy X Get Y Free promotions: let the "buy" side be a mix of several
-- items whose combined quantity counts toward the Buy Quantity threshold
-- (not just one single item). promotions.product_id is kept (set to the
-- first selected buy item) to satisfy its existing not-null constraint and
-- for backward compatibility with promotions that only ever had one item.
-- Run this in Supabase SQL Editor.

create table if not exists promotion_products (
  id uuid primary key default gen_random_uuid(),
  promotion_id uuid not null references promotions(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (promotion_id, product_id)
);

create index if not exists idx_promotion_products_promotion on promotion_products(promotion_id);

alter table promotion_products enable row level security;
drop policy if exists "authenticated_full_access" on promotion_products;
create policy "authenticated_full_access" on promotion_products for all to authenticated using (true) with check (true);
