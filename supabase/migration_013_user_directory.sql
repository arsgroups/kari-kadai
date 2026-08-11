-- Exposes a safe, admin-only view of user emails (auth.users isn't normally
-- reachable from the app's API) so Settings can show a "who's who" list to
-- assign roles against, without giving non-admins any visibility into it.
-- Run this in Supabase SQL Editor.

create or replace view admin_user_directory as
select u.id as user_id, u.email, u.created_at
from auth.users u
where exists (select 1 from user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin');

grant select on admin_user_directory to authenticated;
