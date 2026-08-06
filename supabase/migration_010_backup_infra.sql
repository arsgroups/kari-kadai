-- V2: Automated backup infrastructure (settings, logs, trigger).
-- Run this in Supabase SQL Editor.
--
-- IMPORTANT: before running, replace REPLACE_WITH_YOUR_OWN_RANDOM_SECRET
-- below with a random string you generate yourself (e.g. run
-- `openssl rand -hex 32` in any terminal, or use a password generator).
-- This same value must also be set as the BACKUP_TRIGGER_SECRET secret on
-- the Edge Function (see the deployment steps) — it's how Postgres proves to
-- the function that a call genuinely came from your database trigger, not
-- some random internet request. Do not commit this value to git; it only
-- needs to exist in these two places (Vault, and the function's secret
-- store).

create extension if not exists pg_net;
create extension if not exists supabase_vault;

create table if not exists backup_settings (
  id uuid primary key default gen_random_uuid(),
  enable_auto_backup boolean not null default false,
  backup_time time not null default '23:30',
  drive_folder_id text,
  keep_local_backup_days integer not null default 30,
  retention_policy text default 'Keep all backups in Drive; local browser downloads are not retained automatically.',
  updated_at timestamptz not null default now()
);

-- Single-row settings table.
insert into backup_settings (enable_auto_backup)
select false
where not exists (select 1 from backup_settings);

create table if not exists backup_logs (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  status text not null check (status in ('running', 'success', 'failed')),
  files jsonb,
  error text,
  attempt_count integer not null default 1,
  created_at timestamptz not null default now()
);

create index if not exists idx_backup_logs_date on backup_logs(date);

alter table backup_settings enable row level security;
drop policy if exists "authenticated_full_access" on backup_settings;
create policy "authenticated_full_access" on backup_settings for all to authenticated using (true) with check (true);

alter table backup_logs enable row level security;
drop policy if exists "authenticated_full_access" on backup_logs;
create policy "authenticated_full_access" on backup_logs for all to authenticated using (true) with check (true);

-- Stores the shared secret in Supabase Vault (encrypted at rest, not
-- readable over the anon/authenticated API) instead of a database-level
-- setting, since managed Supabase projects don't allow ALTER DATABASE SET.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'backup_trigger_secret') then
    perform vault.create_secret(
      'REPLACE_WITH_YOUR_OWN_RANDOM_SECRET',
      'backup_trigger_secret',
      'Shared secret the daily_closing trigger sends to the daily-backup Edge Function'
    );
  end if;
end $$;

create or replace function trg_daily_closing_backup() returns trigger as $$
declare
  secret_value text;
begin
  if new.actual_cash_counted is not null then
    select decrypted_secret into secret_value
    from vault.decrypted_secrets
    where name = 'backup_trigger_secret';

    perform net.http_post(
      url := 'https://jirmkxlbicprndisetsq.supabase.co/functions/v1/daily-backup',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'X-Backup-Secret', secret_value
      ),
      body := jsonb_build_object('date', new.date::text, 'trigger', 'daily_closing')
    );
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists daily_closing_backup on daily_closing;
create trigger daily_closing_backup
  after insert or update on daily_closing
  for each row execute function trg_daily_closing_backup();
