-- A single on/off switch for whether Managing Partner Salary is calculated
-- and shown at all in Reports -> Month End Report (GP) and Profit Report.
-- When off, both reports skip the calculation entirely (treated as if the
-- rate were 0%) and hide the line from the P&L Statement, rather than
-- showing a $0.00 row.
-- Run this in Supabase SQL Editor.

create table if not exists partner_salary_settings (
  id uuid primary key default gen_random_uuid(),
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into partner_salary_settings (enabled)
select true
where not exists (select 1 from partner_salary_settings);

alter table partner_salary_settings enable row level security;
drop policy if exists "authenticated_full_access" on partner_salary_settings;
create policy "authenticated_full_access" on partner_salary_settings for all to authenticated using (true) with check (true);
