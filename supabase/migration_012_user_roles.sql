-- Role-based access: 'admin' (sees everything) vs 'sales' (Monthly Expenses,
-- GST, Reports, and Settings hidden from the menu and blocked by route).
-- Run this in Supabase SQL Editor.
--
-- IMPORTANT: after running this, every login defaults to the 'sales' role
-- (least-privilege by default) until you explicitly promote an account.
-- See Step 2 below — do this right away or you'll lock yourself out of
-- Reports/Settings/GST/Monthly Expenses too.

create table if not exists user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'sales' check (role in ('admin', 'sales')),
  created_at timestamptz not null default now()
);

alter table user_roles enable row level security;

-- Anyone logged in can read the role list (needed so the app can look up
-- its own user's role after login).
drop policy if exists "authenticated_read" on user_roles;
create policy "authenticated_read" on user_roles for select to authenticated using (true);

-- Only existing admins can create/change/remove role assignments.
drop policy if exists "admins_write" on user_roles;
create policy "admins_write" on user_roles for all to authenticated
  using (exists (select 1 from user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'))
  with check (exists (select 1 from user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'));

-- ============================================================================
-- Step 2 (do this now): mark your own account as admin.
-- Replace the email below with the one you actually log in with.
-- ============================================================================

insert into user_roles (user_id, role)
select id, 'admin' from auth.users where email = 'REPLACE_WITH_YOUR_LOGIN_EMAIL'
on conflict (user_id) do update set role = 'admin';

-- Repeat that insert (with 'sales' instead of 'admin') for any staff logins,
-- or leave them unassigned — they'll default to 'sales' automatically.
