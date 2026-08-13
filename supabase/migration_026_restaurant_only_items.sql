-- Add the Restaurant-specific menu items, hidden from Counter and Home
-- Delivery (visible only on the Restaurant channel).
-- Run this in Supabase SQL Editor.

with new_products as (
  insert into products (name, category, unit, purchase_unit, sales_unit, low_stock_threshold) values
    ('RESTAURANT CHICKEN MYSORE', 'Restaurant Chicken', 'Kg', 'Kg', 'Kg', 0),
    ('RESTAURANT MUTTON MYSORE', 'Restaurant Mutton', 'Kg', 'Kg', 'Kg', 0),
    ('RESTAURANT CHICKEN CUT 4', 'Restaurant Chicken', 'Kg', 'Kg', 'Kg', 0),
    ('RESTAURANT CHICKEN LIVER', 'Restaurant Chicken', 'Kg', 'Kg', 'Kg', 0),
    ('RESTAURANT CHICKEN WING', 'Restaurant Chicken', 'Kg', 'Kg', 'Kg', 0),
    ('RESTAURANT CHICKEN LEG BONELESS', 'Restaurant Chicken', 'Kg', 'Kg', 'Kg', 0),
    ('RESTAURANT CHICKEN BREAST', 'Restaurant Chicken', 'Kg', 'Kg', 'Kg', 0),
    ('RESTAURANT WHOLE CHICKEN 1.2', 'Restaurant Chicken', 'Unit', 'Unit', 'Unit', 0),
    ('RESTAURANT WHOLE CHICKEN 1.4', 'Restaurant Chicken', 'Unit', 'Unit', 'Unit', 0),
    ('RESTAURANT WHOLE CHICKEN 1.6', 'Restaurant Chicken', 'Unit', 'Unit', 'Unit', 0),
    ('RESTAURANT MUTTON WITH BONE', 'Restaurant Mutton', 'Kg', 'Kg', 'Kg', 0),
    ('RESTAURANT MUTTON LIVER SET', 'Restaurant Mutton', 'Unit', 'Unit', 'Unit', 0),
    ('RESTAURANT MUTTON KUDAL', 'Restaurant Mutton', 'Kg', 'Kg', 'Kg', 0),
    ('RESTAURANT MUTTON RIBS', 'Restaurant Mutton', 'Kg', 'Kg', 'Kg', 0),
    ('RESTAURANT MUTTON SOUP', 'Restaurant Mutton', 'Kg', 'Kg', 'Kg', 0),
    ('RESTAURANT MUTTON DALCHA', 'Restaurant Mutton', 'Kg', 'Kg', 'Kg', 0),
    ('RESTAURANT PAYA SET', 'Restaurant Mutton', 'Unit', 'Unit', 'Unit', 0),
    ('RESTAURANT MUTTON CHOP', 'Restaurant Mutton', 'Kg', 'Kg', 'Kg', 0),
    ('RESTAURANT LAMB SHANK', 'Restaurant Mutton', 'Kg', 'Kg', 'Kg', 0),
    ('RESTAURANT TULANG', 'Restaurant Mutton', 'Kg', 'Kg', 'Kg', 0)
  returning id
)
insert into product_channel_config (product_id, channel, is_visible)
select id, channel, false
from new_products
cross join (values ('Counter'), ('Home Delivery')) as hidden_channels(channel);
