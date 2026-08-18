-- Configurable invoice header/footer images: uploaded via Settings, stored
-- in a public Storage bucket, referenced by URL from a single-row settings
-- table. If unset, the app falls back to its bundled default header image
-- and shows no footer image (just the existing text footer).
-- Run this in Supabase SQL Editor.

insert into storage.buckets (id, name, public)
values ('branding', 'branding', true)
on conflict (id) do nothing;

drop policy if exists "branding_public_read" on storage.objects;
create policy "branding_public_read" on storage.objects for select to public using (bucket_id = 'branding');

drop policy if exists "branding_authenticated_write" on storage.objects;
create policy "branding_authenticated_write" on storage.objects for insert to authenticated
  with check (bucket_id = 'branding');

drop policy if exists "branding_authenticated_update" on storage.objects;
create policy "branding_authenticated_update" on storage.objects for update to authenticated
  using (bucket_id = 'branding');

drop policy if exists "branding_authenticated_delete" on storage.objects;
create policy "branding_authenticated_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'branding');

create table if not exists branding_settings (
  id uuid primary key default gen_random_uuid(),
  header_image_url text,
  footer_image_url text,
  updated_at timestamptz not null default now()
);

insert into branding_settings (id)
select gen_random_uuid()
where not exists (select 1 from branding_settings);

alter table branding_settings enable row level security;
drop policy if exists "authenticated_full_access" on branding_settings;
create policy "authenticated_full_access" on branding_settings for all to authenticated using (true) with check (true);
