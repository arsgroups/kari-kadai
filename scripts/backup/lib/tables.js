// Every table backed up/restored by this tool, parent-first so a restore's
// INSERTs never hit a foreign key before the row it points to exists.
// Restore truncates in the reverse of this order (children first) for the
// same reason. Keep this in sync with supabase/schema.sql if a table (or a
// new foreign key between two of these) is ever added.
export const TABLE_ORDER = [
  'products',
  'suppliers',
  'customers',
  'expense_categories',
  'yield_configurations',
  'yield_configuration_items',
  'product_channel_config',
  'customer_item_prices',
  'promotions',
  'promotion_products',
  'purchase_invoices',
  'purchase_invoice_items',
  'supplier_payments',
  'sale_invoices',
  'sale_invoice_items',
  'sale_returns',
  'sale_return_items',
  'customer_payments',
  'quotations',
  'quotation_items',
  'stock_movements',
  'stock_verifications',
  'daily_closing',
  'gst_rate_history',
  'gst_returns',
  'user_roles',
  'audit_log',
  'branding_settings',
]

export const STORAGE_BUCKETS = ['branding']
