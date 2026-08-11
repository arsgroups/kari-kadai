-- Reset Item Master: remove every existing product and load the real
-- item list, each hidden from the Restaurant channel (visible only on
-- Counter and Home Delivery, which is the default so no override needed).
-- Safe only because no sale/purchase invoices have been recorded yet --
-- those tables block deleting a product they already reference.
-- Run this in Supabase SQL Editor.

-- Clear any existing Yield Configuration (parent->child cutting) setup
-- first -- child_product_id doesn't cascade-delete, so old rows would
-- otherwise block removing the products below.
delete from yield_configuration_items;
delete from yield_configurations;

delete from products;

alter sequence item_code_seq restart with 1;

with new_products as (
  insert into products (name, category, unit, purchase_unit, sales_unit, low_stock_threshold) values
    ('Fresh Goat / Lamb Boneless', 'Fresh Goat/Lamb', 'Kg', 'Kg', 'Kg', 0),
    ('Fresh Goat / Lamb With Bone', 'Fresh Goat/Lamb', 'Kg', 'Kg', 'Kg', 0),
    ('Fresh Goat / Lamb Chops', 'Fresh Goat/Lamb', 'Kg', 'Kg', 'Kg', 0),
    ('Fresh Goat / Lamb Ribs', 'Fresh Goat/Lamb', 'Kg', 'Kg', 'Kg', 0),
    ('Fresh Goat / Lamb Minced Meat', 'Fresh Goat/Lamb', 'Kg', 'Kg', 'Kg', 0),
    ('Fresh Mutton Boneless', 'Fresh Mutton', 'Kg', 'Kg', 'Kg', 0),
    ('Fresh Mutton With Bone', 'Fresh Mutton', 'Kg', 'Kg', 'Kg', 0),
    ('Fresh Mutton Chops', 'Fresh Mutton', 'Kg', 'Kg', 'Kg', 0),
    ('Fresh Mutton Ribs', 'Fresh Mutton', 'Kg', 'Kg', 'Kg', 0),
    ('Frozen Mutton Boneless', 'Frozen Mutton', 'Kg', 'Kg', 'Kg', 0),
    ('Frozen Mutton With Bone', 'Frozen Mutton', 'Kg', 'Kg', 'Kg', 0),
    ('Frozen Mutton Chops', 'Frozen Mutton', 'Kg', 'Kg', 'Kg', 0),
    ('Frozen Mutton Ribs', 'Frozen Mutton', 'Kg', 'Kg', 'Kg', 0),
    ('Mutton Bone', 'Mutton Offal', 'Kg', 'Kg', 'Kg', 0),
    ('Mutton Liver', 'Mutton Offal', 'Kg', 'Kg', 'Kg', 0),
    ('Mutton Trips', 'Mutton Offal', 'Kg', 'Kg', 'Kg', 0),
    ('Mutton Brain', 'Mutton Offal', 'Kg', 'Kg', 'Kg', 0),
    ('Mutton Spleen (3pcs)', 'Mutton Offal', 'Unit', 'Unit', 'Unit', 0),
    ('Paya Set (4pcs)', 'Mutton Offal', 'Unit', 'Unit', 'Unit', 0)
  returning id
)
insert into product_channel_config (product_id, channel, is_visible)
select id, 'Restaurant', false from new_products;
