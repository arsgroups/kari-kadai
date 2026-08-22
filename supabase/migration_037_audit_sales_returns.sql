-- Log Sales Returns to the Audit Log, same as Sale/Purchase Invoices.
-- Run this in Supabase SQL Editor.

create or replace function log_audit_event() returns trigger as $$
declare
  actor text;
  row_data jsonb;
  ref text;
begin
  actor := coalesce(auth.jwt() ->> 'email', auth.uid()::text, 'system');
  row_data := to_jsonb(coalesce(new, old));
  ref := coalesce(row_data->>'invoice_number', row_data->>'return_number', row_data->>'name', row_data->>'date');

  insert into audit_log (user_email, action)
  values (
    actor,
    TG_ARGV[0] || ' ' || lower(TG_OP) || case when ref is not null then ' — ' || ref else '' end
  );

  return coalesce(new, old);
end;
$$ language plpgsql security definer;

drop trigger if exists audit_sale_returns on sale_returns;
create trigger audit_sale_returns after insert or delete on sale_returns
  for each row execute function log_audit_event('Sales Return');
