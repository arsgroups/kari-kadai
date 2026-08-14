-- Simple, lightweight audit log: one table, one generic trigger function,
-- attached to the tables worth knowing "who did what" on. No diffing, no
-- big JSON payloads -- just who, what happened, and a short reference
-- (invoice number / item name / etc. when available).
-- Run this in Supabase SQL Editor.

create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  user_email text,
  action text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_log_created_at on audit_log(created_at desc);

alter table audit_log enable row level security;
drop policy if exists "authenticated_full_access" on audit_log;
create policy "authenticated_full_access" on audit_log for all to authenticated using (true) with check (true);

create or replace function log_audit_event() returns trigger as $$
declare
  actor text;
  row_data jsonb;
  ref text;
begin
  actor := coalesce(auth.jwt() ->> 'email', auth.uid()::text, 'system');
  row_data := to_jsonb(coalesce(new, old));
  ref := coalesce(row_data->>'invoice_number', row_data->>'name', row_data->>'date');

  insert into audit_log (user_email, action)
  values (
    actor,
    TG_ARGV[0] || ' ' || lower(TG_OP) || case when ref is not null then ' — ' || ref else '' end
  );

  return coalesce(new, old);
end;
$$ language plpgsql security definer;

-- Financial documents: created + deleted (not every edit, to stay lightweight).
drop trigger if exists audit_sale_invoices on sale_invoices;
create trigger audit_sale_invoices after insert or delete on sale_invoices
  for each row execute function log_audit_event('Sale Invoice');

drop trigger if exists audit_purchase_invoices on purchase_invoices;
create trigger audit_purchase_invoices after insert or delete on purchase_invoices
  for each row execute function log_audit_event('Purchase Invoice');

drop trigger if exists audit_customer_payments on customer_payments;
create trigger audit_customer_payments after insert on customer_payments
  for each row execute function log_audit_event('Customer Payment');

drop trigger if exists audit_supplier_payments on supplier_payments;
create trigger audit_supplier_payments after insert on supplier_payments
  for each row execute function log_audit_event('Supplier Payment');

-- Master data: created + deleted.
drop trigger if exists audit_products on products;
create trigger audit_products after insert or delete on products
  for each row execute function log_audit_event('Item');

drop trigger if exists audit_customers on customers;
create trigger audit_customers after insert or delete on customers
  for each row execute function log_audit_event('Customer');

drop trigger if exists audit_suppliers on suppliers;
create trigger audit_suppliers after insert or delete on suppliers
  for each row execute function log_audit_event('Supplier');

-- Business config that's worth a record either way.
drop trigger if exists audit_promotions on promotions;
create trigger audit_promotions after insert or update or delete on promotions
  for each row execute function log_audit_event('Promotion');

drop trigger if exists audit_user_roles on user_roles;
create trigger audit_user_roles after insert or update on user_roles
  for each row execute function log_audit_event('User Role');

drop trigger if exists audit_daily_closing on daily_closing;
create trigger audit_daily_closing after insert or update on daily_closing
  for each row execute function log_audit_event('Daily Closing');
