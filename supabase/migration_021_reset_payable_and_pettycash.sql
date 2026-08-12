-- Zero out "Total Payable" and "Petty Cash Balance" on the Dashboard by
-- removing the underlying entries entirely (not an offsetting adjustment).
-- Run this in Supabase SQL Editor.

-- Total Payable (v_supplier_outstanding) = Credit purchase invoices minus
-- supplier payments. Clear both source tables. Stock_movements logged by
-- those purchases aren't FK-linked, so remove them first or they'd be
-- orphaned and leave stock incorrectly inflated.
delete from stock_movements
where reference_type = 'purchase'
  and reference_id in (select id from purchase_invoice_items);

delete from purchase_invoices;
delete from supplier_payments;

alter sequence purchase_invoice_seq restart with 1;

-- Petty Cash Balance (v_petty_cash_balance) sums topup/expense rows in
-- `expenses` where scope = 'daily'. Remove them so it's 0 with no history.
delete from expenses where scope = 'daily';
