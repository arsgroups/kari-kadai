-- Promotions: time-bound offers on a specific item, either a discount
-- (percent or fixed amount) or a "Buy X Get Y Free" deal. Applied
-- automatically on the Sales Invoice while the invoice date falls within
-- the promotion's period.
-- Run this in Supabase SQL Editor.

create table if not exists promotions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  product_id uuid not null references products(id) on delete cascade,
  promo_type text not null check (promo_type in ('discount', 'buy_x_get_y')),
  discount_type text check (discount_type in ('percent', 'fixed')),
  discount_value numeric,
  buy_qty numeric,
  free_qty numeric,
  start_date date not null,
  end_date date not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  check (
    (promo_type = 'discount' and discount_type is not null and discount_value is not null)
    or
    (promo_type = 'buy_x_get_y' and buy_qty is not null and free_qty is not null)
  ),
  check (end_date >= start_date)
);

create index if not exists idx_promotions_product on promotions(product_id);
create index if not exists idx_promotions_dates on promotions(start_date, end_date);

alter table promotions enable row level security;
drop policy if exists "authenticated_full_access" on promotions;
create policy "authenticated_full_access" on promotions for all to authenticated using (true) with check (true);
