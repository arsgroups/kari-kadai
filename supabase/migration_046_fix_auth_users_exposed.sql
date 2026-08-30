-- Fixes Supabase Security Advisor's "auth_users_exposed" critical finding.
-- admin_user_directory was a plain view selecting from auth.users, gated
-- only by a `where is_admin()` clause. Views run with their owner's
-- privileges (not the querying role's), so the advisor flags ANY view over
-- auth.users as a risk regardless of that WHERE clause -- Postgres's own
-- row-level security on auth.users never actually gets a say.
--
-- Fix: replace the view with a SECURITY DEFINER function. It exposes the
-- same three columns for the same admins-only purpose (Settings -> User
-- Roles), but the admin check now happens inside a function the advisor
-- doesn't flag, and a non-admin calling it gets a hard error instead of a
-- (theoretically) empty-but-still-exposed view.
-- Run this in Supabase SQL Editor.

drop view if exists admin_user_directory;

create or replace function admin_user_directory()
returns table (user_id uuid, email text, created_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'not authorized';
  end if;
  return query select u.id, u.email, u.created_at from auth.users u;
end;
$$;

revoke all on function admin_user_directory() from public;
grant execute on function admin_user_directory() to authenticated;
