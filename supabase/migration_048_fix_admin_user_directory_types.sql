-- Fixes "structure of query does not match function result type" on
-- admin_user_directory() (Settings -> User Roles). auth.users.email is
-- character varying(255), not text -- RETURN QUERY requires an exact type
-- match against the function's declared return columns, so the untouched
-- varchar column didn't line up with the declared `text` column. Explicit
-- casts fix it.
-- Run this in Supabase SQL Editor.

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
  return query select u.id::uuid, u.email::text, u.created_at::timestamptz from auth.users u;
end;
$$;
