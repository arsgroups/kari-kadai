-- Fixes "infinite recursion detected in policy for relation user_roles" (42P17).
-- The admins_write policy checked admin status by querying user_roles itself,
-- which re-triggered its own RLS evaluation recursively. A security-definer
-- function breaks the loop (it runs with the function owner's privileges,
-- bypassing RLS for its own internal lookup).
-- Run this in Supabase SQL Editor.

create or replace function is_admin() returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists (select 1 from user_roles where user_id = auth.uid() and role = 'admin');
$$;

drop policy if exists "admins_write" on user_roles;
create policy "admins_write" on user_roles for all to authenticated
  using (is_admin())
  with check (is_admin());

-- admin_user_directory had the same recursive pattern via its WHERE clause.
create or replace view admin_user_directory as
select u.id as user_id, u.email, u.created_at
from auth.users u
where is_admin();

grant select on admin_user_directory to authenticated;
