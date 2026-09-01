import { useEffect, useState } from 'react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts'
import { fetchMonthEndRawData } from '../../lib/monthEndReportData'
import { computeMonthEndReport } from '../../lib/monthEndReport'
import { formatMoney, formatDate } from '../../lib/format'
import ReportPrintHeader from '../../components/ReportPrintHeader'

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function monthLabel(year, month) {
  return `${MONTH_NAMES[month - 1]} ${year}`
}

function fmtPct(v) {
  return v == null ? 'N/A' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`
}

function ChangeBadge({ value, isPct }) {
  if (value == null) return <span className="tag tag-muted">N/A</span>
  const cls = value > 0 ? 'tag-success' : value < 0 ? 'tag-danger' : 'tag-muted'
  const text = isPct ? fmtPct(value) : `${value > 0 ? '+' : ''}${formatMoney(value)}`
  return <span className={`tag ${cls}`}>{text}</span>
}

function KpiCard({ label, value, compare, invertGood }) {
  return (
    <div className="tile">
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
      {compare != null && (
        <div style={{ marginTop: '0.3rem' }}>
          <ChangeBadge value={invertGood ? -compare : compare} isPct={false} />
        </div>
      )}
    </div>
  )
}

// A "month-end" report is normally run once that month has actually
// closed -- default to the last full month rather than the current
// (likely still in-progress) one.
function defaultReportMonth() {
  const now = new Date()
  const currentMonth = now.getMonth() + 1 // 1-12
  return currentMonth === 1 ? { year: now.getFullYear() - 1, month: 12 } : { year: now.getFullYear(), month: currentMonth - 1 }
}

export default function MonthEndReportTab() {
  const [year, setYear] = useState(defaultReportMonth().year)
  const [month, setMonth] = useState(defaultReportMonth().month)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [report, setReport] = useState(null)

  async function generate() {
    setLoading(true)
    setError('')
    try {
      const raw = await fetchMonthEndRawData({ year, month })
      setReport(computeMonthEndReport(raw))
    } catch (e) {
      setError(e.message)
      setReport(null)
    }
    setLoading(false)
  }

  useEffect(() => {
    generate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month])

  const r = report

  return (
    <div>
      <ReportPrintHeader title={r ? `Month-End Management Report — ${monthLabel(year, month)}` : 'Month-End Management Report'} />

      <div className="card no-print">
        <div className="form-grid">
          <label>
            Month / Year
            <input
              type="month"
              value={`${year}-${String(month).padStart(2, '0')}`}
              onChange={(e) => {
                const [y, m] = e.target.value.split('-').map(Number)
                setYear(y)
                setMonth(m)
              }}
            />
          </label>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button className="btn" onClick={generate} disabled={loading}>
              {loading ? 'Generating…' : 'Regenerate Report'}
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button className="btn-secondary" onClick={() => window.print()} disabled={!r}>
              Print / Export PDF (browser print)
            </button>
          </div>
        </div>
        <p className="muted" style={{ fontSize: '0.8rem', marginBottom: 0 }}>
          A dedicated professional PDF/Excel export is planned as a follow-up — use Print for now (your
          browser's own "Save as PDF" destination produces a clean PDF of everything below).
        </p>
      </div>

      {error && <div className="inline-error">{error}</div>}
      {loading && <p className="muted">Generating report…</p>}

      {r && (
        <div className="invoice-sheet">
          <h1 style={{ marginBottom: 0 }}>Month-End Management &amp; P&amp;L Report</h1>
          <p className="muted" style={{ marginTop: '0.2rem' }}>
            Reporting Period: <strong>{monthLabel(year, month)}</strong> · Compared against{' '}
            <strong>{monthLabel(...(month === 1 ? [year - 1, 12] : [year, month - 1]))}</strong> · Prepared{' '}
            {new Date().toLocaleString('en-SG')}
          </p>
          <p className="muted" style={{ fontSize: '0.8rem' }}>Confidential — prepared for internal management and stakeholder review only.</p>

          {!r.previousMonthHasData && (
            <div className="inline-error" style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}>
              No comparable data found for the previous month ({monthLabel(...(month === 1 ? [year - 1, 12] : [year, month - 1]))}).
              Month-on-month comparisons below are shown as "N/A" rather than a misleading 0% or infinite change.
            </div>
          )}

          {/* ==================== 1. EXECUTIVE DASHBOARD ==================== */}
          <h2>Executive Dashboard</h2>
          <div className="summary-tiles">
            <KpiCard label="Revenue" value={r.current.hasSalesData ? formatMoney(r.current.revenue) : 'Data unavailable'} compare={r.previous.hasSalesData ? r.current.revenue - r.previous.revenue : null} />
            <KpiCard label="Gross Profit" value={formatMoney(r.current.grossProfit)} compare={r.previousMonthHasData ? r.current.grossProfit - r.previous.grossProfit : null} />
            <KpiCard label="Gross Margin" value={r.current.grossMarginPct != null ? `${r.current.grossMarginPct.toFixed(1)}%` : 'N/A'} />
            <KpiCard label="Operating Expenses" value={formatMoney(r.current.totalOperatingExpenses)} compare={r.previousMonthHasData ? r.current.totalOperatingExpenses - r.previous.totalOperatingExpenses : null} invertGood />
            <KpiCard label={`Managing Partner Fee (${r.feeRatePercent}%)`} value={formatMoney(r.current.partnerFee)} />
            <KpiCard label="Fixed Assets" value={formatMoney(r.current.fixedAssetExpenses)} />
            <KpiCard label="Net Profit" value={formatMoney(r.current.finalNetProfit)} compare={r.previousMonthHasData ? r.current.finalNetProfit - r.previous.finalNetProfit : null} />
            <KpiCard label="Net Profit Margin" value={r.current.netMarginPct != null ? `${r.current.netMarginPct.toFixed(1)}%` : 'N/A'} />
            <KpiCard label="Closing Stock" value={formatMoney(r.inventory.closingStockValue)} compare={r.inventory.closingStockValue - r.inventory.openingStockValue} />
          </div>

          {/* ==================== MANAGEMENT HIGHLIGHTS ==================== */}
          <h2>Management Highlights</h2>
          <ul>
            {r.highlights.lines.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>

          {/* ==================== 2. P&L STATEMENT ==================== */}
          <h2>Profit &amp; Loss Statement</h2>
          <table className="data-table" style={{ maxWidth: 520 }}>
            <tbody>
              <tr>
                <td>Revenue — Total Sales</td>
                <td>{r.current.hasSalesData ? formatMoney(r.current.revenue) : 'Data unavailable'}</td>
              </tr>
              <tr>
                <td>Cost of Sales — Purchases / COGS</td>
                <td>{r.current.hasPurchaseData ? formatMoney(r.current.cogs) : 'Data unavailable'}</td>
              </tr>
              <tr style={{ fontWeight: 700 }}>
                <td>= Gross Profit</td>
                <td>{formatMoney(r.current.grossProfit)}</td>
              </tr>
              <tr>
                <td>Gross Profit Margin %</td>
                <td>{r.current.grossMarginPct != null ? `${r.current.grossMarginPct.toFixed(1)}%` : 'N/A'}</td>
              </tr>
              <tr>
                <td colSpan={2}>&nbsp;</td>
              </tr>
              <tr>
                <td>Daily Expenses</td>
                <td>{formatMoney(r.current.dailyExpenses)}</td>
              </tr>
              <tr>
                <td>Monthly Operating Expenses</td>
                <td>{formatMoney(r.current.monthlyExpenses)}</td>
              </tr>
              <tr style={{ fontWeight: 700 }}>
                <td>= Profit Before Managing Partner Fee</td>
                <td>{formatMoney(r.current.profitBeforeFee)}</td>
              </tr>
              <tr>
                <td>Managing Partner Fee — {r.feeRatePercent}% of Profit</td>
                <td>{formatMoney(r.current.partnerFee)}</td>
              </tr>
              <tr style={{ fontWeight: 700 }}>
                <td>= Profit After Managing Partner Fee</td>
                <td>{formatMoney(r.current.profitAfterFee)}</td>
              </tr>
              <tr>
                <td colSpan={2}>&nbsp;</td>
              </tr>
              <tr>
                <td>Fixed Asset / Capital Expenditure</td>
                <td>{formatMoney(r.current.fixedAssetExpenses)}</td>
              </tr>
              <tr style={{ fontWeight: 700, fontSize: '1.05rem' }}>
                <td>= Final Net Profit</td>
                <td>
                  <span className={r.current.finalNetProfit >= 0 ? 'tag tag-success' : 'tag tag-danger'}>
                    {formatMoney(r.current.finalNetProfit)}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
          <p className="muted" style={{ fontSize: '0.8rem' }}>
            The Managing Partner Fee is calculated on Profit Before Fee — before Fixed Asset expenditure is
            deducted — and is applied as-is even in a loss month (not floored at zero). Fixed Assets never
            reduce the fee base; they are deducted only in the final step above.
          </p>

          {/* ==================== 3. CAPITAL ==================== */}
          <h2>Capital &amp; Funding Position</h2>
          <table className="data-table" style={{ maxWidth: 480 }}>
            <tbody>
              <tr>
                <td>Opening Capital</td>
                <td>{formatMoney(r.capital.openingCapital)}</td>
              </tr>
              <tr>
                <td>+ Additional Capital Introduced</td>
                <td>{formatMoney(r.capital.additionalCapital)}</td>
              </tr>
              <tr>
                <td>− Capital Withdrawn / Drawings</td>
                <td>{formatMoney(r.capital.withdrawals)}</td>
              </tr>
              <tr style={{ fontWeight: 700 }}>
                <td>= Closing Capital</td>
                <td>{formatMoney(r.capital.closingCapital)}</td>
              </tr>
            </tbody>
          </table>
          {!r.capital.hasHistory && (
            <p className="muted" style={{ fontSize: '0.8rem' }}>
              No capital transactions have been logged yet (Capital page) — Opening/Closing Capital above are
              $0.00 by default, not necessarily the true balance.
            </p>
          )}
          <h3>Capital Transactions This Month</h3>
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Partner / Investor</th>
                <th>Type</th>
                <th>Amount</th>
                <th>Description</th>
                <th>Reference</th>
              </tr>
            </thead>
            <tbody>
              {r.capital.transactions.map((t) => (
                <tr key={t.id}>
                  <td>{formatDate(t.date)}</td>
                  <td>{t.partner_name}</td>
                  <td>{t.transaction_type === 'contribution' ? 'Contribution' : 'Withdrawal'}</td>
                  <td>{formatMoney(t.amount)}</td>
                  <td>{t.description}</td>
                  <td>{t.reference}</td>
                </tr>
              ))}
              {r.capital.transactions.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    No capital transactions this month.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {/* ==================== 4. SALES & CHANNEL ==================== */}
          <h2>Sales &amp; Channel Performance</h2>
          <div className="no-print" style={{ maxWidth: 640 }}>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={r.channelAnalysis.rows}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="channel" />
                <YAxis />
                <Tooltip formatter={(v) => formatMoney(v)} />
                <Legend />
                <Bar dataKey="previous" name={monthLabel(...(month === 1 ? [year - 1, 12] : [year, month - 1]))} fill="#c9b8a8" />
                <Bar dataKey="current" name={monthLabel(year, month)} fill="#7a1f1f" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Sales Channel</th>
                <th>Previous Month</th>
                <th>Current Month</th>
                <th>Difference</th>
                <th>% Change</th>
                <th>Contribution %</th>
              </tr>
            </thead>
            <tbody>
              {r.channelAnalysis.rows.map((c) => (
                <tr key={c.channel}>
                  <td>{c.channel}</td>
                  <td>{formatMoney(c.previous)}</td>
                  <td>{formatMoney(c.current)}</td>
                  <td>{formatMoney(c.change)}</td>
                  <td><ChangeBadge value={c.pctChange} isPct /></td>
                  <td>{c.contributionPct != null ? `${c.contributionPct.toFixed(1)}%` : 'N/A'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul style={{ fontSize: '0.9rem' }}>
            {r.channelAnalysis.best && (
              <li>
                <strong>Best Performing Channel:</strong> {r.channelAnalysis.best.channel} ({fmtPct(r.channelAnalysis.best.pctChange)})
              </li>
            )}
            {r.channelAnalysis.weakest && (
              <li>
                <strong>Weakest Channel:</strong> {r.channelAnalysis.weakest.channel} ({fmtPct(r.channelAnalysis.weakest.pctChange)})
              </li>
            )}
            {r.channelAnalysis.topContributor && (
              <li>
                <strong>Largest Revenue Contributor:</strong> {r.channelAnalysis.topContributor.channel} (
                {r.channelAnalysis.topContributor.contributionPct?.toFixed(1)}% of total sales)
              </li>
            )}
          </ul>

          {/* ==================== 5. GROSS PROFIT & PRODUCT PROFITABILITY ==================== */}
          <h2>Gross Profit &amp; Product Profitability</h2>
          <h3>Purchases by Item (this month)</h3>
          <table className="data-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Purchase Cost</th>
              </tr>
            </thead>
            <tbody>
              {r.purchasesByItem.map((p) => (
                <tr key={p.name}>
                  <td>{p.name}</td>
                  <td>{formatMoney(p.amount)}</td>
                </tr>
              ))}
              {r.purchasesByItem.length === 0 && (
                <tr>
                  <td colSpan={2} className="muted">No purchases recorded this month.</td>
                </tr>
              )}
            </tbody>
          </table>

          <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 280 }}>
              <h3>Top 10 Products by Sales</h3>
              <table className="data-table">
                <thead>
                  <tr><th>Item</th><th>Revenue</th></tr>
                </thead>
                <tbody>
                  {r.topProducts.bySales.map((p) => (
                    <tr key={p.name}><td>{p.name}</td><td>{formatMoney(p.revenue)}</td></tr>
                  ))}
                  {r.topProducts.bySales.length === 0 && <tr><td colSpan={2} className="muted">No itemized sales this month.</td></tr>}
                </tbody>
              </table>
            </div>
            <div style={{ flex: 1, minWidth: 280 }}>
              <h3>Top 10 Products by Gross Profit</h3>
              <table className="data-table">
                <thead>
                  <tr><th>Item</th><th>Gross Profit</th></tr>
                </thead>
                <tbody>
                  {r.topProducts.byGrossProfit.map((p) => (
                    <tr key={p.name}><td>{p.name}</td><td>{formatMoney(p.grossProfit)}</td></tr>
                  ))}
                  {r.topProducts.byGrossProfit.length === 0 && <tr><td colSpan={2} className="muted">No itemized sales this month.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          {/* ==================== 6. OPERATING EXPENSES & COST-CUTTING ==================== */}
          <h2>Operating Expenses &amp; Cost-Cutting Analysis</h2>
          <table className="data-table">
            <thead>
              <tr><th>Category</th><th>Current Month</th></tr>
            </thead>
            <tbody>
              {r.current.expenseByCategory.map((c) => (
                <tr key={c.name}><td>{c.name}</td><td>{formatMoney(c.amount)}</td></tr>
              ))}
              {r.current.expenseByCategory.length === 0 && <tr><td colSpan={2} className="muted">No operating expenses this month.</td></tr>}
            </tbody>
          </table>

          <h3>Cost Cutting &amp; Expense Efficiency</h3>
          {r.costCutting.savings.length > 0 ? (
            <table className="data-table">
              <thead>
                <tr><th>Expense</th><th>Previous</th><th>Current</th><th>Savings</th><th>Reduction %</th></tr>
              </thead>
              <tbody>
                {r.costCutting.savings.map((c) => (
                  <tr key={c.name}>
                    <td>{c.name}</td>
                    <td>{formatMoney(c.previous)}</td>
                    <td>{formatMoney(c.current)}</td>
                    <td>{formatMoney(c.savings)}</td>
                    <td>{c.reductionPct != null ? `${c.reductionPct.toFixed(1)}%` : 'N/A'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">No expense category decreased compared with the previous month.</p>
          )}
          <p><strong>Total operating expense savings this month: {formatMoney(r.costCutting.totalSavings)}.</strong></p>

          {r.costCutting.increases.length > 0 && (
            <>
              <h3>Notable Increases</h3>
              <table className="data-table">
                <thead>
                  <tr><th>Expense</th><th>Previous</th><th>Current</th><th>Increase</th></tr>
                </thead>
                <tbody>
                  {r.costCutting.increases.map((c) => (
                    <tr key={c.name}>
                      <td>{c.name}</td>
                      <td>{formatMoney(c.previous)}</td>
                      <td>{formatMoney(c.current)}</td>
                      <td>{formatMoney(-c.savings)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          {r.costCutting.insufficientData.length > 0 && (
            <p className="muted" style={{ fontSize: '0.8rem' }}>
              Insufficient comparable data (only appears in one of the two months) for:{' '}
              {r.costCutting.insufficientData.map((c) => c.name).join(', ')} — not counted as a saving or an
              increase.
            </p>
          )}

          {/* ==================== 7. MANAGING PARTNER FEE & FIXED ASSETS ==================== */}
          <h2>Managing Partner Fee &amp; Fixed Asset Analysis</h2>
          <table className="data-table" style={{ maxWidth: 480 }}>
            <tbody>
              <tr><td>Gross Profit</td><td>{formatMoney(r.current.grossProfit)}</td></tr>
              <tr><td>− Operating Expenses (Daily + Monthly)</td><td>{formatMoney(r.current.totalOperatingExpenses)}</td></tr>
              <tr style={{ fontWeight: 700 }}><td>= Profit Before Managing Partner Fee &amp; Fixed Assets</td><td>{formatMoney(r.current.profitBeforeFee)}</td></tr>
              <tr><td>Managing Partner Fee ({r.feeRatePercent}% of the line above)</td><td>{formatMoney(r.current.partnerFee)}</td></tr>
              <tr style={{ fontWeight: 700 }}><td>= Profit After Managing Partner Fee</td><td>{formatMoney(r.current.profitAfterFee)}</td></tr>
              <tr><td>− Fixed Asset / Capital Expenditure</td><td>{formatMoney(r.current.fixedAssetExpenses)}</td></tr>
              <tr style={{ fontWeight: 700 }}><td>= Final Net Profit</td><td>{formatMoney(r.current.finalNetProfit)}</td></tr>
            </tbody>
          </table>
          <h3>Fixed Asset / Capital Expenditure Breakdown</h3>
          <table className="data-table">
            <thead><tr><th>Category</th><th>Amount</th></tr></thead>
            <tbody>
              {r.current.fixedAssetByCategory.map((c) => (
                <tr key={c.name}><td>{c.name}</td><td>{formatMoney(c.amount)}</td></tr>
              ))}
              {r.current.fixedAssetByCategory.length === 0 && (
                <tr><td colSpan={2} className="muted">No Fixed Asset / Capex spend this month.</td></tr>
              )}
            </tbody>
          </table>

          {/* ==================== 8. INVENTORY ==================== */}
          <h2>Inventory / Stock Management</h2>
          <p className="muted" style={{ fontSize: '0.8rem' }}>
            Stock values use each item's current average cost applied to that date's quantity, not the
            historical cost actually in effect on each date — see Reports → Inventory Valuation for the same
            methodology.
          </p>
          <table className="data-table" style={{ maxWidth: 520 }}>
            <tbody>
              <tr><td>Opening Stock Value</td><td>{formatMoney(r.inventory.openingStockValue)}</td></tr>
              <tr><td>+ Purchases</td><td>{formatMoney(r.current.cogs)}</td></tr>
              <tr><td>Closing Stock Value</td><td>{formatMoney(r.inventory.closingStockValue)}</td></tr>
              <tr><td>Number of SKUs in Stock</td><td>{r.inventory.skuCount}</td></tr>
              <tr><td>Low-Stock Items</td><td>{r.inventory.lowStock.length}</td></tr>
              <tr><td>Out-of-Stock Items</td><td>{r.inventory.outOfStock.length}</td></tr>
            </tbody>
          </table>

          <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 240 }}>
              <h3>Fast-Moving Items</h3>
              <table className="data-table">
                <thead><tr><th>Item</th><th>Qty Sold</th></tr></thead>
                <tbody>
                  {r.inventory.fastMoving.map((i) => (
                    <tr key={i.productId}><td>{i.name}</td><td>{i.qtySoldThisMonth} {i.unit}</td></tr>
                  ))}
                  {r.inventory.fastMoving.length === 0 && <tr><td colSpan={2} className="muted">No sales this month.</td></tr>}
                </tbody>
              </table>
            </div>
            <div style={{ flex: 1, minWidth: 240 }}>
              <h3>Slow-Moving Items</h3>
              <p className="muted" style={{ fontSize: '0.75rem', marginTop: 0 }}>Currently in stock, zero sales this month.</p>
              <table className="data-table">
                <thead><tr><th>Item</th><th>Current Stock</th></tr></thead>
                <tbody>
                  {r.inventory.slowMoving.map((i) => (
                    <tr key={i.productId}><td>{i.name}</td><td>{i.currentQty} {i.unit}</td></tr>
                  ))}
                  {r.inventory.slowMoving.length === 0 && <tr><td colSpan={2} className="muted">None.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <h3>Item-Level Stock Comparison</h3>
          <table className="data-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Previous Closing Qty</th>
                <th>Current Closing Qty</th>
                <th>Change</th>
                <th>Previous Value</th>
                <th>Current Value</th>
              </tr>
            </thead>
            <tbody>
              {r.inventory.itemRows.map((i) => (
                <tr key={i.productId}>
                  <td>{i.name}</td>
                  <td>{i.previousQty} {i.unit}</td>
                  <td>{i.currentQty} {i.unit}</td>
                  <td>{i.changeQty > 0 ? '+' : ''}{i.changeQty} {i.unit}</td>
                  <td>{formatMoney(i.previousValue)}</td>
                  <td>{formatMoney(i.currentValue)}</td>
                </tr>
              ))}
              {r.inventory.itemRows.length === 0 && (
                <tr><td colSpan={6} className="muted">No stock movement in either month.</td></tr>
              )}
            </tbody>
          </table>

          {/* ==================== 9. MONTH-ON-MONTH ==================== */}
          <h2>Month-on-Month Management Analysis</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>KPI</th>
                <th>Previous Month</th>
                <th>Current Month</th>
                <th>Difference</th>
                <th>% Change</th>
              </tr>
            </thead>
            <tbody>
              {r.momKpis.map((k) => (
                <tr key={k.label}>
                  <td>{k.label}</td>
                  <td>{k.isPct ? (k.previous != null ? `${k.previous.toFixed(1)}%` : 'N/A') : formatMoney(k.previous)}</td>
                  <td>{k.isPct ? (k.current != null ? `${k.current.toFixed(1)}%` : 'N/A') : formatMoney(k.current)}</td>
                  <td>{k.isPct ? (k.change != null ? `${k.change > 0 ? '+' : ''}${k.change.toFixed(1)} pts` : 'N/A') : formatMoney(k.change)}</td>
                  <td>{k.isPct ? 'N/A' : <ChangeBadge value={k.pctChange} isPct />}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* ==================== 10. RECONCILIATION ==================== */}
          <h2>Management Observations &amp; Reconciliation Checks</h2>
          <table className="data-table">
            <thead><tr><th>Check</th><th>Detail</th><th>Status</th></tr></thead>
            <tbody>
              {r.reconciliation.checks.map((c) => (
                <tr key={c.label}>
                  <td>{c.label}</td>
                  <td style={{ fontSize: '0.8rem' }}>{c.detail}</td>
                  <td>
                    <span className={c.ok ? 'tag tag-success' : 'tag tag-danger'}>{c.ok ? 'OK' : 'DISCREPANCY'}</span>
                  </td>
                </tr>
              ))}
              <tr>
                <td>{r.reconciliation.inventoryNote.label}</td>
                <td style={{ fontSize: '0.8rem' }}>{r.reconciliation.inventoryNote.detail}</td>
                <td><span className="tag tag-muted">Informational</span></td>
              </tr>
            </tbody>
          </table>

          <div className="invoice-footer">
            <p className="muted">This report is confidential and prepared for internal management and stakeholder review.</p>
          </div>
        </div>
      )}
    </div>
  )
}
