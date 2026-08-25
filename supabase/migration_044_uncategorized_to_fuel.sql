-- Reclassifies every expense with no category (shows as "Uncategorized" in
-- reports) as "Fuel" -- creates the Fuel category first if it doesn't exist.
-- Run this in Supabase SQL Editor.

insert into expense_categories (name, classification)
values ('Fuel', 'variable')
on conflict (name) do nothing;

update expenses
set category_id = (select id from expense_categories where name = 'Fuel')
where category_id is null;
