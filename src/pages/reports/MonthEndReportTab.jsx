import { useEffect, useState } from 'react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts'
import { fetchMonthEndRawData } from '../../lib/monthEndReportData'
import { computeMonthEndReport } from '../../lib/monthEndReport'
import { formatMoney } from '../../lib/format'
import ReportPrintHeader from '../../components/ReportPrintHeader'

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function monthLabel(year, month) {
  return `${MONTH_NAMES[month - 1]} ${year}`
}

function previousMonthOf(year, month) {
  return month === 1 ? [year - 1, 12] : [year, month - 1]
}

function nextMonthOf(year, month) {
  return month === 12 ? [year + 1, 1] : [year, month + 1]
}

function fmtPct(v) {
  return v == null ? 'N/A' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`
}

function pctDiff(current, previous) {
  if (previous == null || current == null) return null
  if (previous === 0) return current === 0 ? 0 : null
  return ((current - previous) / Math.abs(previous)) * 100
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
  const [prevYear, prevMonth] = previousMonthOf(year, month)
  const [nextYear, nextMonth] = nextMonthOf(year, month)
  const salesGrowthPct = r ? pctDiff(r.current.revenue, r.previous.revenue) : null
  const salesGrowthValue = r && r.previousMonthHasData ? r.current.revenue - r.previous.revenue : null

  return (
    <div>
      <ReportPrintHeader title={r ? `Month End Report (GP) — ${monthLabel(year, month)}` : 'Month End Report (GP)'} />

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
      </div>

      {error && <div className="inline-error">{error}</div>}
      {loading && <p className="muted">Generating report…</p>}

      {r && (
        <div className="invoice-sheet">
          <h1 style={{ marginBottom: 0 }}>Month End Report (GP)</h1>
          <p className="muted" style={{ marginTop: '0.2rem' }}>
            Reporting Period: <strong>{monthLabel(year, month)}</strong> · Compared against{' '}
            <strong>{monthLabel(prevYear, prevMonth)}</strong> · Prepared {new Date().toLocaleString('en-SG')}
          </p>
          <p className="muted" style={{ fontSize: '0.8rem' }}>Confidential — prepared for internal management and stakeholder review only.</p>

          {!r.previousMonthHasData && (
            <div className="inline-error" style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}>
              No comparable data found for the previous month ({monthLabel(prevYear, prevMonth)}). Month-on-month
              comparisons below are shown as "N/A" rather than a misleading 0% or infinite change.
            </div>
          )}

          {/* ==================== DASHBOARD ==================== */}
          <h2>Dashboard</h2>
          <div className="summary-tiles">
            <KpiCard label="Sales" value={r.current.hasSalesData ? formatMoney(r.current.revenue) : 'Data unavailable'} compare={r.previous.hasSalesData ? r.current.revenue - r.previous.revenue : null} />
            <KpiCard label="Purchase" value={r.current.hasPurchaseData ? formatMoney(r.current.cogs) : 'Data unavailable'} compare={r.previous.hasPurchaseData ? r.current.cogs - r.previous.cogs : null} invertGood />
            <KpiCard label="Gross Margin" value={formatMoney(r.current.adjustedGrossMargin)} compare={r.previousMonthHasData ? r.current.adjustedGrossMargin - r.previous.adjustedGrossMargin : null} />
          </div>
          <p className="muted" style={{ fontSize: '0.8rem' }}>
            Gross Margin = Gross Profit − Daily Expenses − Managing Partner Salary ({r.feeRatePercent}% of Gross
            Profit).
          </p>

          {/* ==================== PERFORMANCE SUMMARY ==================== */}
          <h2>Performance Summary</h2>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {r.highlights.lines.map((line, i) => (
              <li
                key={i}
                style={{
                  fontSize: '1.35rem',
                  fontWeight: 700,
                  lineHeight: 1.5,
                  marginBottom: '0.6rem',
                  color: line.tone === 'good' ? 'var(--success)' : line.tone === 'bad' ? 'var(--danger)' : 'inherit',
                }}
              >
                {line.text}
              </li>
            ))}
          </ul>

          {/* ==================== P&L STATEMENT ==================== */}
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
                <td colSpan={2}>&nbsp;</td>
              </tr>
              <tr>
                <td>Daily Expenses</td>
                <td>{formatMoney(r.current.dailyExpenses)}</td>
              </tr>
              <tr>
                <td>Managing Partner Salary ({r.feeRatePercent}%)</td>
                <td>{formatMoney(r.current.partnerFee)}</td>
              </tr>
              <tr style={{ fontWeight: 700, fontSize: '1.05rem' }}>
                <td>= Gross Profit Margin</td>
                <td>
                  <span className={r.current.adjustedGrossMargin >= 0 ? 'tag tag-success' : 'tag tag-danger'}>
                    {formatMoney(r.current.adjustedGrossMargin)}
                    {r.current.adjustedGrossMarginPct != null && ` (${r.current.adjustedGrossMarginPct.toFixed(1)}%)`}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>

          {/* ==================== SALES & CHANNEL PERFORMANCE ==================== */}
          <h2>Sales &amp; Channel Performance</h2>

          {salesGrowthValue != null && (
            <div style={{ textAlign: 'center', margin: '0.5rem 0 1.5rem' }}>
              <div
                style={{
                  fontSize: '3rem',
                  fontWeight: 800,
                  lineHeight: 1.1,
                  color: salesGrowthValue >= 0 ? 'var(--success)' : 'var(--danger)',
                }}
              >
                {salesGrowthValue >= 0 ? '▲' : '▼'} {fmtPct(salesGrowthPct)}
              </div>
              <div style={{ fontSize: '1.3rem', fontWeight: 600 }}>
                Sales {salesGrowthValue >= 0 ? 'up' : 'down'} {formatMoney(Math.abs(salesGrowthValue))} vs{' '}
                {monthLabel(prevYear, prevMonth)}
              </div>
            </div>
          )}

          <div className="no-print" style={{ maxWidth: 760, margin: '0 auto' }}>
            <ResponsiveContainer width="100%" height={380}>
              <BarChart data={r.channelAnalysis.rows}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="channel" tick={{ fontSize: 14, fontWeight: 600 }} />
                <YAxis tick={{ fontSize: 13 }} />
                <Tooltip formatter={(v) => formatMoney(v)} />
                <Legend wrapperStyle={{ fontSize: 14 }} />
                <Bar dataKey="previous" name={monthLabel(prevYear, prevMonth)} fill="#c9b8a8" />
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

          {/* ==================== NEXT MONTH TARGET ==================== */}
          <h2>{monthLabel(nextYear, nextMonth)} Target</h2>
          <p className="muted" style={{ fontSize: '0.85rem' }}>
            Set at {r.nextMonthTarget.lowPct}%–{r.nextMonthTarget.highPct}% growth over {monthLabel(year, month)}'s
            actual sales, split across channels using each channel's own {monthLabel(year, month)} sales as its
            base.
          </p>
          <div className="summary-tiles">
            <div className="tile">
              <div className="tile-label">{monthLabel(year, month)} Sales (Base)</div>
              <div className="tile-value">{formatMoney(r.nextMonthTarget.currentSales)}</div>
            </div>
            <div className="tile">
              <div className="tile-label">Target ({r.nextMonthTarget.lowPct}%)</div>
              <div className="tile-value">{formatMoney(r.nextMonthTarget.targetLow)}</div>
            </div>
            <div className="tile">
              <div className="tile-label">Target ({r.nextMonthTarget.highPct}%)</div>
              <div className="tile-value">{formatMoney(r.nextMonthTarget.targetHigh)}</div>
            </div>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Channel</th>
                <th>{monthLabel(year, month)} Sales</th>
                <th>Target ({r.nextMonthTarget.lowPct}%)</th>
                <th>Target ({r.nextMonthTarget.highPct}%)</th>
              </tr>
            </thead>
            <tbody>
              {r.nextMonthTarget.channels.map((c) => (
                <tr key={c.channel}>
                  <td>{c.channel}</td>
                  <td>{formatMoney(c.currentSales)}</td>
                  <td>{formatMoney(c.targetLow)}</td>
                  <td>{formatMoney(c.targetHigh)}</td>
                </tr>
              ))}
              {r.nextMonthTarget.channels.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">No channel sales this month to base a target on.</td>
                </tr>
              )}
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
