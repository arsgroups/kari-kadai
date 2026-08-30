-- Supports the local backup/restore tool in scripts/backup/. Two admin-only
-- functions a restore needs that PostgREST can't do directly:
--
-- 1. admin_set_triggers(enable) -- turns every user-defined trigger in the
--    public schema on/off. A plain re-INSERT of backed-up rows through
--    PostgREST fires every trigger exactly like a real new sale/purchase
--    would (stock deductions, average-cost bumps, audit log entries,
--    surcharge recalculation...), which would double-count all of it
--    against data that already reflects those effects. Restore disables
--    triggers first, inserts the raw rows, then re-enables them.
-- 2. admin_truncate_table(table) -- clears one table before restoring into
--    it, validated against an allow-list of actual public tables (defence
--    in depth on top of format(%I) identifier-quoting).
--
-- Both raise an exception for anyone who isn't an admin (is_admin(), same
-- check used everywhere else in this schema) -- a non-admin login can't
-- wipe or touch triggers on any table through these.
-- Run this in Supabase SQL Editor.

create or replace function admin_set_triggers(p_enable boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  r record;
begin
  if not is_admin() then
    raise exception 'not authorized';
  end if;
  for r in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I %s trigger user', r.tablename, case when p_enable then 'enable' else 'disable' end);
  end loop;
end;
$$;

revoke all on function admin_set_triggers(boolean) from public;
grant execute on function admin_set_triggers(boolean) to authenticated;

create or replace function admin_truncate_table(p_table text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'not authorized';
  end if;
  if p_table !~ '^[a-z_][a-z0-9_]*$' or not exists (
    select 1 from pg_tables where schemaname = 'public' and tablename = p_table
  ) then
    raise exception 'invalid table name: %', p_table;
  end if;
  execute format('truncate table public.%I', p_table);
end;
$$;

revoke all on function admin_truncate_table(text) from public;
grant execute on function admin_truncate_table(text) to authenticated;
