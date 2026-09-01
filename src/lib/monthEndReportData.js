import { supabase } from './supabaseClient'
import { round2 } from './gst'
import { toISODate } from './format'
import { monthRanges } from './monthEndReport'

function dayBefore(isoDate) {
  const d = new Date(isoDate + 'T00:00:00')
  d.setDate(d.getDate() - 1)
  return toISODate(d)
}

async function fetchAllRows(query) {
  const pageSize = 1000
  let from = 0
  let all = []
  for (;;) {
    const { data, error } = await query.range(from, from + pageSize - 1)
    if (error) throw error
    all = all.concat(data ?? [])
    if (!data || data.length < pageSize) break
    from += pageSize
  }
  return all
}

async function fetchStockValueAsOf(asOfDate, products) {
  const totals = {}
  const movements = await fetchAllRows(
    supabase.from('stock_movements').select('product_id, quantity').lte('date', asOfDate)
  )
  movements.forEach((m) => {
    totals[m.product_id] = (totals[m.product_id] ?? 0) + Number(m.quantity)
  })
  let value = 0
  const byProduct = {}
  products.forEach((p) => {
    const qty = round2(totals[p.id] ?? 0)
    const costRate = p.average_cost || p.default_purchase_price || 0
    const val = round2(qty * costRate)
    byProduct[p.id] = { qty, value: val }
    value += val
  })
  return { totalValue: round2(value), byProduct }
}

// Every raw row the Month-End Report's calculation engine needs, for both
// the selected month and the one immediately before it, plus three
// point-in-time inventory snapshots (two months back, one month back, and
// the selected month's end).
export async function fetchMonthEndRawData({ year, month }) {
  const { currentStart, currentEnd, previousStart, previousEnd } = monthRanges(year, month)
  const twoMonthsAgoEnd = dayBefore(previousStart)

  const [
    currentSales,
    previousSales,
    currentPurchases,
    previousPurchases,
    currentPurchaseItems,
    currentExpenses,
    previousExpenses,
    capitalBefore,
    capitalDuring,
    products,
    partnerFeeRates,
    currentSaleItems,
    previousSaleItems,
    currentReturnItems,
    previousReturnItems,
  ] = await Promise.all([
    fetchAllRows(supabase.from('sale_invoices').select('id, date, total, channel').gte('date', currentStart).lte('date', currentEnd)),
    fetchAllRows(supabase.from('sale_invoices').select('id, date, total, channel').gte('date', previousStart).lte('date', previousEnd)),
    fetchAllRows(supabase.from('purchase_invoices').select('id, date, total').gte('date', currentStart).lte('date', currentEnd)),
    fetchAllRows(supabase.from('purchase_invoices').select('id, date, total').gte('date', previousStart).lte('date', previousEnd)),
    fetchAllRows(
      supabase
        .from('purchase_invoice_items')
        .select('product_id, amount, products(name), purchase_invoices!inner(date)')
        .gte('purchase_invoices.date', currentStart)
        .lte('purchase_invoices.date', currentEnd)
    ),
    fetchAllRows(
      supabase
        .from('expenses')
        .select('date, scope, amount, category_id, expense_categories(name, is_fixed_asset)')
        .eq('entry_type', 'expense')
        .gte('date', currentStart)
        .lte('date', currentEnd)
    ),
    fetchAllRows(
      supabase
        .from('expenses')
        .select('date, scope, amount, category_id, expense_categories(name, is_fixed_asset)')
        .eq('entry_type', 'expense')
        .gte('date', previousStart)
        .lte('date', previousEnd)
    ),
    fetchAllRows(supabase.from('capital_transactions').select('*').lt('date', currentStart)),
    fetchAllRows(supabase.from('capital_transactions').select('*').gte('date', currentStart).lte('date', currentEnd)),
    fetchAllRows(
      supabase
        .from('products')
        .select('id, name, category, unit, average_cost, default_purchase_price, low_stock_threshold, is_active')
        .eq('is_active', true)
    ),
    fetchAllRows(supabase.from('partner_fee_rate_history').select('effective_from, rate_percent').order('effective_from')),
    fetchAllRows(
      supabase
        .from('sale_invoice_items')
        .select('id, product_id, quantity, amount, unit_cost, products(name), sale_invoices!inner(date)')
        .gte('sale_invoices.date', currentStart)
        .lte('sale_invoices.date', currentEnd)
    ),
    fetchAllRows(
      supabase
        .from('sale_invoice_items')
        .select('id, product_id, quantity, amount, unit_cost, products(name), sale_invoices!inner(date)')
        .gte('sale_invoices.date', previousStart)
        .lte('sale_invoices.date', previousEnd)
    ),
    fetchAllRows(
      supabase
        .from('sale_return_items')
        .select('sale_invoice_item_id, quantity, amount, sale_returns!inner(date)')
        .gte('sale_returns.date', currentStart)
        .lte('sale_returns.date', currentEnd)
    ),
    fetchAllRows(
      supabase
        .from('sale_return_items')
        .select('sale_invoice_item_id, quantity, amount, sale_returns!inner(date)')
        .gte('sale_returns.date', previousStart)
        .lte('sale_returns.date', previousEnd)
    ),
  ])

  const [stockAtTwoMonthsAgoEnd, stockAtPreviousEnd, stockAtCurrentEnd] = await Promise.all([
    fetchStockValueAsOf(twoMonthsAgoEnd, products),
    fetchStockValueAsOf(previousEnd, products),
    fetchStockValueAsOf(currentEnd, products),
  ])

  return {
    ranges: { currentStart, currentEnd, previousStart, previousEnd },
    currentSales,
    previousSales,
    currentPurchases,
    previousPurchases,
    currentPurchaseItems,
    currentExpenses,
    previousExpenses,
    capitalBefore,
    capitalDuring,
    products,
    partnerFeeRates,
    currentSaleItems,
    previousSaleItems,
    currentReturnItems,
    previousReturnItems,
    stockAtTwoMonthsAgoEnd,
    stockAtPreviousEnd,
    stockAtCurrentEnd,
  }
}
