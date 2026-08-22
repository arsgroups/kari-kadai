-- Full reset #2: clears every transaction/history table so the app can be
-- used as if brand new. Only the Item Master (products) and its own setup
-- survive -- name, category, units, ALL pricing (Default/Restaurant/Counter
-- Selling Price, Default Purchase Price), channel visibility, Yield
-- Configuration, Promotions, and GST rate history (all treated as item/
-- pricing config, not "entries"). Everything else -- customers, suppliers,
-- sales, purchases, sales returns, quotations, expenses, closings, GST
-- returns, audit log, backups -- is wiped, and current stock resets to 0
-- (stock quantity is a transaction log, not part of the Item Master).
--
-- This is NOT reversible. Run only when you're sure.
-- Run this in Supabase SQL Editor.

-- Sales Returns must go before Sale Invoices (they reference the invoice).
delete from sale_return_items;
delete from sale_returns;

-- Stock quantities: clearing every movement brings every item's current
-- stock back to 0 (v_current_stock sums movements, defaulting to 0).
delete from stock_movements;
delete from stock_verifications;

-- Quotations (cascades quotation_items).
delete from quotations;

-- Old V1 tables (renamed, not dropped, long ago) still hold customer_id/
-- supplier_id references -- must clear before the master records below or
-- their deletion will be blocked.
delete from sales_legacy;
delete from purchases_legacy;

-- Sales (cascades sale_invoice_items) -- must go before deleting customers.
delete from sale_invoices;

-- Purchases (cascades purchase_invoice_items) -- must go before deleting suppliers.
delete from purchase_invoices;

delete from customer_payments;
delete from supplier_payments;

-- Customers and Suppliers themselves (cascades customer_item_prices).
delete from customers;
delete from suppliers;

delete from expenses;
delete from daily_closing;
delete from gst_returns;
delete from audit_log;
delete from backup_logs;

-- Average cost is derived from purchase history, which is now gone.
update products set average_cost = 0;

alter sequence sale_invoice_seq restart with 1;
alter sequence purchase_invoice_seq restart with 1;
alter sequence quotation_seq restart with 1;
alter sequence sale_return_seq restart with 1;
