// Pure calculation engine -- no I/O, no Supabase import. Every figure in
// the Month-End Report is derived here from plain data structures, so the
// order of calculation (Section 23 of the spec) is never ambiguous and the
// whole thing is testable with a hand-built fixture instead of a live
// database. Fetching the raw rows this expects lives in
// monthEndReportData.js (fetchMonthEndRawData), which returns exactly the
// shape computeMonthEndReport() below consumes.
import { round2 } from './gst'
import { toISODate } from './format'

// ============================================================================
// DATE HELPERS
// ============================================================================

// { year, month } -- month is 1-12. Returns ISO start/end (inclusive) for
// that calendar month and for the one immediately before it.
export function monthRanges(year, month) {
  const start = new Date(year, month - 1, 1)
  const end = new Date(year, month, 0) // day 0 of next month = last day of this month
  const prevStart = new Date(year, month - 2, 1)
  const prevEnd = new Date(year, month - 1, 0)
  return {
    currentStart: toISODate(start),
    currentEnd: toISODate(end),
    previousStart: toISODate(prevStart),
    previousEnd: toISODate(prevEnd),
  }
}

// ============================================================================
// SAFE MATH -- never divide by zero, never invent a number when the
// baseline is genuinely absent.
// ============================================================================

// null means "can't compute / not meaningful", NOT zero.
function pctChange(current, previous) {
  if (previous == null || current == null) return null
  if (previous === 0) return current === 0 ? 0 : null // no baseline to grow from
  return round2(((current - previous) / Math.abs(previous)) * 100)
}

function pctOf(part, whole) {
  if (whole == null || part == null || whole === 0) return null
  return round2((part / whole) * 100)
}

// ============================================================================
// PURE COMPUTATION -- given raw rows, produce every figure in the report.
// Deterministic, no I/O, so it's the same "calculation engine" whether it's
// driven by real fetched data or a hand-built test fixture (see
// Section 33's test scenarios: normal month, no previous-month data,
// negative profit, zero previous month, etc.).
// ============================================================================

function sum(rows, key) {
  return rows.reduce((s, r) => s + Number(r[key] ?? 0), 0)
}

// Nets sale_return_items back out of sale_invoice_items before any revenue/
// margin figure is computed -- a return is never counted as a sale,
// matching every other report in this app.
function netReturns(saleItems, returnItems) {
  const returnedByItemId = {}
  returnItems.forEach((r) => {
    returnedByItemId[r.sale_invoice_item_id] = (returnedByItemId[r.sale_invoice_item_id] ?? 0) + r.amount
  })
  return saleItems.map((it) => ({
    ...it,
    amount: round2(it.amount - (returnedByItemId[it.id] ?? 0)),
  }))
}

function computeExpenseSplit(expenseRows) {
  let daily = 0
  let monthly = 0
  let fixedAsset = 0
  const byCategory = {} // operating only: name -> amount
  const fixedAssetByCategory = {} // Fixed Asset/Capex only: name -> amount
  expenseRows.forEach((e) => {
    const isFixedAsset = e.expense_categories?.is_fixed_asset === true
    const name = e.expense_categories?.name ?? 'Uncategorized'
    if (isFixedAsset) {
      fixedAsset += Number(e.amount)
      fixedAssetByCategory[name] = (fixedAssetByCategory[name] ?? 0) + Number(e.amount)
    } else {
      byCategory[name] = (byCategory[name] ?? 0) + Number(e.amount)
      if (e.scope === 'daily') daily += Number(e.amount)
      else monthly += Number(e.amount)
    }
  })
  return {
    daily: round2(daily),
    monthly: round2(monthly),
    fixedAsset: round2(fixedAsset),
    operatingTotal: round2(daily + monthly),
    byCategory: Object.entries(byCategory)
      .map(([name, amount]) => ({ name, amount: round2(amount) }))
      .sort((a, b) => b.amount - a.amount),
    fixedAssetByCategory: Object.entries(fixedAssetByCategory)
      .map(([name, amount]) => ({ name, amount: round2(amount) }))
      .sort((a, b) => b.amount - a.amount),
  }
}

function computeChannelSales(salesRows) {
  const byChannel = {}
  salesRows.forEach((s) => {
    byChannel[s.channel] = (byChannel[s.channel] ?? 0) + Number(s.total)
  })
  return byChannel
}

// Sections 3-12: Capital, Revenue, COGS, Gross Profit, Opex, Managing
// Partner Fee, Fixed Assets, Final Net Profit -- in the exact order
// mandated by the spec, each step built only from the step before it.
function computePnL({ salesRows, purchasesRows, expenseRows, feeRatePercent }) {
  // 1. Revenue
  const revenue = round2(sum(salesRows, 'total'))
  // 2. COGS (this app's established convention: purchase invoice totals for
  // the period -- cash-basis, matching the existing P&L/Sales/Purchases
  // reports, not an inventory-matched "cost of what was sold this month".)
  const cogs = round2(sum(purchasesRows, 'total'))
  // 3. Gross Profit
  const grossProfit = round2(revenue - cogs)
  const grossMarginPct = pctOf(grossProfit, revenue)
  // 4. Operating Expenses (Fixed Asset/Capex categories excluded entirely --
  // they never reduce the Managing Partner Fee base)
  const expenses = computeExpenseSplit(expenseRows)
  // 5. Profit Before Managing Partner Fee & Fixed Assets (an intermediate
  // subtotal shown in the P&L, but NOT the fee's own base -- see below)
  const profitBeforeFee = round2(grossProfit - expenses.operatingTotal)
  // 6. Managing Partner Fee -- a percentage of GROSS PROFIT specifically
  // (not Profit Before Fee, and not Final Net Profit), applied to that base
  // as-is including when Gross Profit itself is negative (confirmed
  // business rule: the fee is not floored at zero on a loss month).
  const partnerFee = round2(grossProfit * (feeRatePercent / 100))
  // 7. Profit After Managing Partner Fee
  const profitAfterFee = round2(profitBeforeFee - partnerFee)
  // 8. Fixed Asset / Capital Expenditure (deducted only now, after the fee)
  const fixedAssetExpenses = expenses.fixedAsset
  // 9. Final Net Profit
  const finalNetProfit = round2(profitAfterFee - fixedAssetExpenses)
  const netMarginPct = pctOf(finalNetProfit, revenue)

  return {
    revenue,
    cogs,
    grossProfit,
    grossMarginPct,
    dailyExpenses: expenses.daily,
    monthlyExpenses: expenses.monthly,
    totalOperatingExpenses: expenses.operatingTotal,
    expenseByCategory: expenses.byCategory,
    fixedAssetByCategory: expenses.fixedAssetByCategory,
    profitBeforeFee,
    feeRatePercent,
    partnerFee,
    profitAfterFee,
    fixedAssetExpenses,
    finalNetProfit,
    netMarginPct,
    hasSalesData: salesRows.length > 0,
    hasPurchaseData: purchasesRows.length > 0,
    hasExpenseData: expenseRows.length > 0,
  }
}

function computeCapital({ capitalBefore, capitalDuring }) {
  const sumType = (rows, type) => round2(rows.filter((r) => r.transaction_type === type).reduce((s, r) => s + Number(r.amount), 0))
  const openingCapital = round2(sumType(capitalBefore, 'contribution') - sumType(capitalBefore, 'withdrawal'))
  const additionalCapital = sumType(capitalDuring, 'contribution')
  const withdrawals = sumType(capitalDuring, 'withdrawal')
  const closingCapital = round2(openingCapital + additionalCapital - withdrawals)
  return {
    openingCapital,
    additionalCapital,
    withdrawals,
    closingCapital,
    transactions: [...capitalDuring].sort((a, b) => a.date.localeCompare(b.date)),
    hasHistory: capitalBefore.length > 0 || capitalDuring.length > 0,
  }
}

function computeChannelAnalysis(currentByChannel, previousByChannel) {
  const channels = [...new Set([...Object.keys(currentByChannel), ...Object.keys(previousByChannel)])]
  const totalCurrent = Object.values(currentByChannel).reduce((s, v) => s + v, 0)
  const rows = channels
    .map((channel) => {
      const current = round2(currentByChannel[channel] ?? 0)
      const previous = round2(previousByChannel[channel] ?? 0)
      return {
        channel,
        current,
        previous,
        change: round2(current - previous),
        pctChange: pctChange(current, previous),
        contributionPct: pctOf(current, totalCurrent),
      }
    })
    .sort((a, b) => b.current - a.current)

  const withGrowth = rows.filter((r) => r.pctChange != null)
  const best = withGrowth.length ? withGrowth.reduce((a, b) => (b.pctChange > a.pctChange ? b : a)) : null
  const weakest = withGrowth.length ? withGrowth.reduce((a, b) => (b.pctChange < a.pctChange ? b : a)) : null
  const topContributor = rows.length ? rows.reduce((a, b) => ((b.contributionPct ?? 0) > (a.contributionPct ?? 0) ? b : a)) : null

  return { rows, best, weakest, topContributor }
}

// currentByCategory/previousByCategory are already operating-only (Fixed
// Asset/Capex categories are split out separately, see computeExpenseSplit).
function computeCostCutting(currentByCategory, previousByCategory) {
  const currentMap = Object.fromEntries(currentByCategory.map((c) => [c.name, c.amount]))
  const previousMap = Object.fromEntries(previousByCategory.map((c) => [c.name, c.amount]))
  const names = [...new Set([...Object.keys(currentMap), ...Object.keys(previousMap)])]

  const comparable = []
  const insufficientData = []
  names.forEach((name) => {
    const hasCurrent = name in currentMap
    const hasPrevious = name in previousMap
    if (!hasCurrent || !hasPrevious) {
      insufficientData.push({ name, current: currentMap[name] ?? null, previous: previousMap[name] ?? null })
      return
    }
    const current = currentMap[name]
    const previous = previousMap[name]
    comparable.push({
      name,
      previous,
      current,
      savings: round2(previous - current),
      reductionPct: pctChange(current, previous) == null ? null : round2(-pctChange(current, previous)),
    })
  })

  const savings = comparable.filter((c) => c.savings > 0).sort((a, b) => b.savings - a.savings)
  const increases = comparable.filter((c) => c.savings < 0).sort((a, b) => a.savings - b.savings)
  const totalSavings = round2(savings.reduce((s, c) => s + c.savings, 0))

  return { savings, increases, insufficientData, totalSavings }
}

function computeInventory({ raw, currentSaleItemsNetted, previousSaleItemsNetted }) {
  const { products, stockAtTwoMonthsAgoEnd, stockAtPreviousEnd, stockAtCurrentEnd } = raw

  const qtySoldByProduct = (rows) => {
    const m = {}
    rows.forEach((r) => {
      m[r.product_id] = (m[r.product_id] ?? 0) + Number(r.quantity)
    })
    return m
  }
  const currentQtySold = qtySoldByProduct(currentSaleItemsNetted)
  const previousQtySold = qtySoldByProduct(previousSaleItemsNetted)

  const itemRows = products.map((p) => {
    const prevSnap = stockAtPreviousEnd.byProduct[p.id] ?? { qty: 0, value: 0 }
    const currSnap = stockAtCurrentEnd.byProduct[p.id] ?? { qty: 0, value: 0 }
    return {
      productId: p.id,
      name: p.name,
      category: p.category,
      unit: p.unit,
      previousQty: prevSnap.qty,
      currentQty: currSnap.qty,
      changeQty: round2(currSnap.qty - prevSnap.qty),
      previousValue: prevSnap.value,
      currentValue: currSnap.value,
      lowStockThreshold: p.low_stock_threshold,
      qtySoldThisMonth: round2(currentQtySold[p.id] ?? 0),
      qtySoldPreviousMonth: round2(previousQtySold[p.id] ?? 0),
    }
  })

  const lowStock = itemRows.filter((r) => r.currentQty > 0 && r.currentQty <= r.lowStockThreshold)
  const outOfStock = itemRows.filter((r) => r.currentQty <= 0)
  const skusInStock = itemRows.filter((r) => r.currentQty > 0)

  // Heuristic, clearly labelled as such: fast-moving = top 5 by quantity
  // sold this month; slow-moving = currently holds stock but sold nothing
  // this month (a full month of zero movement on an item that isn't
  // out-of-stock is the one conclusion the data can actually support
  // without inventing a turnover-ratio threshold).
  const fastMoving = [...itemRows]
    .filter((r) => r.qtySoldThisMonth > 0)
    .sort((a, b) => b.qtySoldThisMonth - a.qtySoldThisMonth)
    .slice(0, 5)
  const slowMoving = itemRows.filter((r) => r.currentQty > 0 && r.qtySoldThisMonth === 0)

  return {
    openingStockValue: stockAtPreviousEnd.totalValue,
    closingStockValue: stockAtCurrentEnd.totalValue,
    previousOpeningStockValue: stockAtTwoMonthsAgoEnd.totalValue,
    previousClosingStockValue: stockAtPreviousEnd.totalValue,
    skuCount: skusInStock.length,
    lowStock,
    outOfStock,
    fastMoving,
    slowMoving,
    itemRows: itemRows.filter((r) => r.previousQty !== 0 || r.currentQty !== 0),
  }
}

function computeTopProducts(saleItemsNetted) {
  const byProduct = {}
  saleItemsNetted.forEach((it) => {
    const name = it.products?.name ?? 'Unknown'
    if (!byProduct[name]) byProduct[name] = { name, revenue: 0, cost: 0, quantity: 0 }
    byProduct[name].revenue += it.amount
    byProduct[name].cost += Number(it.quantity) * Number(it.unit_cost ?? 0)
    byProduct[name].quantity += Number(it.quantity)
  })
  const list = Object.values(byProduct).map((p) => ({
    ...p,
    revenue: round2(p.revenue),
    cost: round2(p.cost),
    grossProfit: round2(p.revenue - p.cost),
  }))
  return {
    bySales: [...list].sort((a, b) => b.revenue - a.revenue).slice(0, 10),
    byGrossProfit: [...list].sort((a, b) => b.grossProfit - a.grossProfit).slice(0, 10),
  }
}

function computeReconciliation({ current, channelAnalysis, inventory }) {
  const tolerance = 0.05

  const channelTotal = round2(channelAnalysis.rows.reduce((s, r) => s + r.current, 0))
  const salesCheck = {
    label: 'Sales Reconciliation',
    detail: `Sum of channel sales (${channelTotal}) vs Total Sales (${current.revenue})`,
    ok: Math.abs(channelTotal - current.revenue) < tolerance,
  }

  const expenseCheck = {
    label: 'Expense Reconciliation',
    detail: `Daily + Monthly (${round2(current.dailyExpenses + current.monthlyExpenses)}) vs Total Operating Expenses (${current.totalOperatingExpenses})`,
    ok: Math.abs(current.dailyExpenses + current.monthlyExpenses - current.totalOperatingExpenses) < tolerance,
  }

  const expectedNet = round2(current.grossProfit - current.totalOperatingExpenses - current.partnerFee - current.fixedAssetExpenses)
  const pnlCheck = {
    label: 'P&L Reconciliation',
    detail: `Gross Profit - Opex - Partner Fee - Fixed Assets (${expectedNet}) vs Final Net Profit (${current.finalNetProfit})`,
    ok: Math.abs(expectedNet - current.finalNetProfit) < tolerance,
  }

  // Informational, not pass/fail: opening + purchases vs closing is
  // expected to drift, because both stock snapshots are valued at TODAY's
  // average cost (Inventory Valuation's documented methodology) while
  // purchases/COGS reflect the actual historical transaction amounts.
  return {
    checks: [salesCheck, expenseCheck, pnlCheck],
    inventoryNote: {
      label: 'Inventory Reconciliation',
      detail: `Opening (${inventory.openingStockValue}) + Purchases (${current.cogs}) vs Closing (${inventory.closingStockValue}). This is informational only -- both stock snapshots are valued at today's average cost, not the cost actually in effect on each historical date, so a variance here is expected and does not by itself indicate an error.`,
      openingPlusPurchases: round2(inventory.openingStockValue + current.cogs),
      closing: inventory.closingStockValue,
    },
  }
}

// Section 19: dynamically generated from the actual computed figures, never
// hand-authored or hard-coded.
function computeHighlights({ current, previous, channelAnalysis, costCutting, inventory }) {
  const lines = []
  const attention = []

  if (current.hasSalesData && previous.hasSalesData) {
    const change = pctChange(current.revenue, previous.revenue)
    if (change != null) {
      lines.push(`Revenue Performance: Sales ${change >= 0 ? 'increased' : 'decreased'} by ${Math.abs(change).toFixed(1)}% compared with the previous month.`)
      if (change <= -10) attention.push(`Sales declined ${Math.abs(change).toFixed(1)}% month-on-month -- review channel performance below.`)
    }
  } else {
    lines.push('Revenue Performance: Previous month has no comparable data -- month-on-month change not shown.')
  }

  lines.push(`Gross Profit: Gross profit was ${current.grossProfit.toFixed(2)} with a margin of ${current.grossMarginPct != null ? current.grossMarginPct.toFixed(1) + '%' : 'N/A'}.`)

  if (costCutting.totalSavings > 0) {
    lines.push(`Expense Management: Total identifiable operating expense savings this month were ${costCutting.totalSavings.toFixed(2)}.`)
  } else if (costCutting.savings.length === 0 && costCutting.increases.length > 0) {
    lines.push('Expense Management: No expense category decreased this month; several increased -- see Cost-Cutting Analysis.')
    attention.push('No operating expense category improved this month -- review the Cost-Cutting Analysis section.')
  }
  if (costCutting.increases.length > 0) {
    const worst = costCutting.increases[0]
    attention.push(`${worst.name} expense increased by ${Math.abs(worst.savings).toFixed(2)} vs last month.`)
  }

  const stockChange = pctChange(inventory.closingStockValue, inventory.openingStockValue)
  if (stockChange != null) {
    lines.push(`Inventory: Closing stock ${stockChange >= 0 ? 'increased' : 'decreased'} by ${Math.abs(stockChange).toFixed(1)}% during the month.`)
  }
  if (inventory.outOfStock.length > 0) {
    attention.push(`${inventory.outOfStock.length} item(s) are out of stock: ${inventory.outOfStock.map((i) => i.name).join(', ')}.`)
  }
  if (inventory.lowStock.length > 0) {
    attention.push(`${inventory.lowStock.length} item(s) are at or below their low-stock threshold.`)
  }

  lines.push(`Profitability: Net profit was ${current.finalNetProfit.toFixed(2)} after Managing Partner Fee and Fixed Asset expenditure.`)
  if (current.finalNetProfit < 0) attention.push('Final Net Profit is negative this month.')

  if (channelAnalysis.weakest && channelAnalysis.weakest.pctChange < -10) {
    attention.push(`${channelAnalysis.weakest.channel} channel declined ${Math.abs(channelAnalysis.weakest.pctChange).toFixed(1)}% -- largest decline of any channel.`)
  }

  return { lines, attention: attention.slice(0, 5) }
}

export function computeMonthEndReport(raw, { feeRatePercentOverride } = {}) {
  const feeRatePercent =
    feeRatePercentOverride ??
    (() => {
      const sorted = [...raw.partnerFeeRates].sort((a, b) => a.effective_from.localeCompare(b.effective_from))
      let applicable = sorted[0]?.rate_percent ?? 10
      sorted.forEach((r) => {
        if (r.effective_from <= raw.ranges.currentStart) applicable = r.rate_percent
      })
      return applicable
    })()

  const currentSaleItemsNetted = netReturns(raw.currentSaleItems, raw.currentReturnItems)
  const previousSaleItemsNetted = netReturns(raw.previousSaleItems, raw.previousReturnItems)

  const current = computePnL({
    salesRows: raw.currentSales,
    purchasesRows: raw.currentPurchases,
    expenseRows: raw.currentExpenses,
    feeRatePercent,
  })
  const previous = computePnL({
    salesRows: raw.previousSales,
    purchasesRows: raw.previousPurchases,
    expenseRows: raw.previousExpenses,
    feeRatePercent,
  })

  const capital = computeCapital(raw)

  const currentByChannel = computeChannelSales(raw.currentSales)
  const previousByChannel = computeChannelSales(raw.previousSales)
  const channelAnalysis = computeChannelAnalysis(currentByChannel, previousByChannel)

  const costCutting = computeCostCutting(current.expenseByCategory, previous.expenseByCategory)

  const inventory = computeInventory({ raw, currentSaleItemsNetted, previousSaleItemsNetted })

  const topProducts = computeTopProducts(currentSaleItemsNetted)

  const purchaseByProduct = {}
  raw.currentPurchaseItems.forEach((it) => {
    const name = it.products?.name ?? 'Unknown'
    purchaseByProduct[name] = (purchaseByProduct[name] ?? 0) + Number(it.amount)
  })
  const purchasesByItem = Object.entries(purchaseByProduct)
    .map(([name, amount]) => ({ name, amount: round2(amount) }))
    .sort((a, b) => b.amount - a.amount)

  const reconciliation = computeReconciliation({ current, channelAnalysis, inventory })

  const momKpis = [
    { label: 'Sales', previous: previous.revenue, current: current.revenue },
    { label: 'Purchases / COGS', previous: previous.cogs, current: current.cogs },
    { label: 'Gross Profit', previous: previous.grossProfit, current: current.grossProfit },
    { label: 'Gross Profit %', previous: previous.grossMarginPct, current: current.grossMarginPct, isPct: true },
    { label: 'Daily Expenses', previous: previous.dailyExpenses, current: current.dailyExpenses },
    { label: 'Monthly Expenses', previous: previous.monthlyExpenses, current: current.monthlyExpenses },
    { label: 'Total Operating Expenses', previous: previous.totalOperatingExpenses, current: current.totalOperatingExpenses },
    { label: 'Managing Partner Fee', previous: previous.partnerFee, current: current.partnerFee },
    { label: 'Fixed Asset Expenses', previous: previous.fixedAssetExpenses, current: current.fixedAssetExpenses },
    { label: 'Net Profit', previous: previous.finalNetProfit, current: current.finalNetProfit },
    { label: 'Net Profit Margin', previous: previous.netMarginPct, current: current.netMarginPct, isPct: true },
    { label: 'Closing Stock Value', previous: inventory.previousClosingStockValue, current: inventory.closingStockValue },
  ].map((k) => ({ ...k, change: k.current != null && k.previous != null ? round2(k.current - k.previous) : null, pctChange: pctChange(k.current, k.previous) }))

  const highlights = computeHighlights({ current, previous, channelAnalysis, costCutting, inventory })

  const previousMonthHasData = raw.previousSales.length > 0 || raw.previousPurchases.length > 0 || raw.previousExpenses.length > 0

  return {
    ranges: raw.ranges,
    feeRatePercent,
    current,
    previous,
    previousMonthHasData,
    capital,
    channelAnalysis,
    costCutting,
    inventory,
    topProducts,
    purchasesByItem,
    reconciliation,
    momKpis,
    highlights,
  }
}
