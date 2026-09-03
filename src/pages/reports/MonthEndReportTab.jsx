import { useEffect, useRef, useState } from 'react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts'
import { fetchMonthEndRawData } from '../../lib/monthEndReportData'
import { computeMonthEndReport } from '../../lib/monthEndReport'
import { formatMoney } from '../../lib/format'
import { COMPANY } from '../../lib/companyInfo'
import ReportPrintHeader from '../../components/ReportPrintHeader'

const BRAND = [122, 31, 31]
const GOOD = [26, 127, 55]
const BAD = [192, 57, 43]

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

function diffText(diff) {
  return `${diff >= 0 ? '+' : '-'}${formatMoney(Math.abs(diff))} vs last month`
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
  const [pdfError, setPdfError] = useState('')
  const [downloadingPdf, setDownloadingPdf] = useState(false)
  const chartRef = useRef(null)

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

  // Builds a proper laid-out, multi-page, corporate-styled PDF -- section
  // headings, bordered KPI cards, tables, a captured copy of the channel
  // chart, and page numbers -- rather than relying on the browser's own
  // print-to-PDF, which can't do any of that.
  async function downloadPdf() {
    if (!report) return
    setDownloadingPdf(true)
    setPdfError('')
    const r = report
    const [prevY, prevM] = previousMonthOf(year, month)
    const [nextY, nextM] = nextMonthOf(year, month)
    const growthPct = pctDiff(r.current.revenue, r.previous.revenue)
    const growthValue = r.previousMonthHasData ? r.current.revenue - r.previous.revenue : null

    try {
      const [{ default: jsPDF }, autoTableModule, html2canvasModule] = await Promise.all([
        import('jspdf'),
        import('jspdf-autotable'),
        import('html2canvas'),
      ])
      const autoTable = autoTableModule.default
      const html2canvas = html2canvasModule.default

      const doc = new jsPDF()
      const pageWidth = doc.internal.pageSize.getWidth()
      const pageHeight = doc.internal.pageSize.getHeight()
      const marginX = 14
      const usableWidth = pageWidth - marginX * 2
      let y = 20

      function ensureSpace(needed) {
        if (y + needed > pageHeight - 22) {
          doc.addPage()
          y = 20
        }
      }

      function sectionTitle(text) {
        ensureSpace(14)
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(13)
        doc.setTextColor(...BRAND)
        doc.text(text, marginX, y)
        doc.setDrawColor(...BRAND)
        doc.setLineWidth(0.6)
        doc.line(marginX, y + 1.8, pageWidth - marginX, y + 1.8)
        doc.setTextColor(20, 20, 20)
        y += 9.5
      }

      function kpiRow(cards) {
        const gap = 6
        const cardW = (usableWidth - gap * (cards.length - 1)) / cards.length
        const cardH = 26
        ensureSpace(cardH + 8)
        cards.forEach((c, i) => {
          const x = marginX + i * (cardW + gap)
          doc.setDrawColor(220, 214, 208)
          doc.setLineWidth(0.3)
          doc.roundedRect(x, y, cardW, cardH, 2, 2)
          doc.setFont('helvetica', 'normal')
          doc.setFontSize(8.5)
          doc.setTextColor(120, 110, 100)
          doc.text(c.label.toUpperCase(), x + 4, y + 7)
          doc.setFont('helvetica', 'bold')
          doc.setFontSize(13.5)
          doc.setTextColor(30, 30, 30)
          doc.text(c.value, x + 4, y + 16)
          if (c.compareText) {
            doc.setFont('helvetica', 'normal')
            doc.setFontSize(8)
            doc.setTextColor(...(c.compareGood ? GOOD : BAD))
            doc.text(c.compareText, x + 4, y + 22)
          }
        })
        doc.setTextColor(20, 20, 20)
        y += cardH + 9
      }

      // ---- Header ----
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(16)
      doc.setTextColor(...BRAND)
      doc.text(COMPANY.name, marginX, y)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8.5)
      doc.setTextColor(90, 90, 90)
      doc.text(`UEN: ${COMPANY.uen}  |  ${COMPANY.addressLine1}, ${COMPANY.addressLine2}`, marginX, y + 5.5)
      doc.setDrawColor(...BRAND)
      doc.setLineWidth(0.8)
      doc.line(marginX, y + 9, pageWidth - marginX, y + 9)
      y += 17

      doc.setFont('helvetica', 'bold')
      doc.setFontSize(18)
      doc.setTextColor(20, 20, 20)
      doc.text('MONTH END REPORT (GP)', pageWidth / 2, y, { align: 'center' })
      y += 7.5
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(11)
      doc.text(`Reporting Period: ${monthLabel(year, month)}`, pageWidth / 2, y, { align: 'center' })
      y += 5.5
      doc.setFontSize(9)
      doc.setTextColor(110, 110, 110)
      doc.text(`Compared against ${monthLabel(prevY, prevM)}  ·  Prepared ${new Date().toLocaleString('en-SG')}`, pageWidth / 2, y, { align: 'center' })
      y += 5
      doc.setFont('helvetica', 'italic')
      doc.setFontSize(8)
      doc.text('Confidential — prepared for internal management and stakeholder review only.', pageWidth / 2, y, { align: 'center' })
      doc.setTextColor(20, 20, 20)
      y += 11

      // ---- Dashboard ----
      sectionTitle('Dashboard')
      kpiRow([
        {
          label: 'Sales',
          value: r.current.hasSalesData ? formatMoney(r.current.revenue) : 'N/A',
          compareText: r.previous.hasSalesData ? diffText(r.current.revenue - r.previous.revenue) : null,
          compareGood: r.current.revenue - r.previous.revenue >= 0,
        },
        {
          label: 'Purchase',
          value: r.current.hasPurchaseData ? formatMoney(r.current.cogs) : 'N/A',
          compareText: r.previous.hasPurchaseData ? diffText(r.current.cogs - r.previous.cogs) : null,
          compareGood: r.current.cogs - r.previous.cogs <= 0,
        },
        {
          label: 'Gross Margin',
          value: formatMoney(r.current.adjustedGrossMargin),
          compareText: r.previousMonthHasData ? diffText(r.current.adjustedGrossMargin - r.previous.adjustedGrossMargin) : null,
          compareGood: r.current.adjustedGrossMargin - r.previous.adjustedGrossMargin >= 0,
        },
      ])

      // ---- Performance Summary ----
      sectionTitle('Performance Summary')
      r.highlights.lines.forEach((line) => {
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(10.5)
        const wrapped = doc.splitTextToSize(line.text, usableWidth - 6)
        ensureSpace(wrapped.length * 5.2 + 3)
        const color = line.tone === 'good' ? GOOD : line.tone === 'bad' ? BAD : [20, 20, 20]
        doc.setFillColor(...color)
        doc.circle(marginX + 1, y - 1.6, 0.9, 'F')
        doc.setTextColor(...color)
        doc.text(wrapped, marginX + 5, y)
        y += wrapped.length * 5.2 + 3
      })
      doc.setTextColor(20, 20, 20)
      y += 2

      // ---- P&L Statement ----
      sectionTitle('Profit & Loss Statement')
      autoTable(doc, {
        startY: y,
        margin: { left: marginX, right: marginX },
        body: [
          ['Revenue — Total Sales', r.current.hasSalesData ? formatMoney(r.current.revenue) : 'Data unavailable'],
          ['Cost of Sales — Purchases / COGS', r.current.hasPurchaseData ? formatMoney(r.current.cogs) : 'Data unavailable'],
          [
            { content: '= Gross Profit', styles: { fontStyle: 'bold' } },
            { content: formatMoney(r.current.grossProfit), styles: { fontStyle: 'bold' } },
          ],
          ['Daily Expenses', formatMoney(r.current.dailyExpenses)],
          [`Managing Partner Salary (${r.feeRatePercent}%)`, formatMoney(r.current.partnerFee)],
          [
            { content: '= Gross Profit Margin', styles: { fontStyle: 'bold', fontSize: 11 } },
            {
              content: `${formatMoney(r.current.adjustedGrossMargin)}${
                r.current.adjustedGrossMarginPct != null ? ` (${r.current.adjustedGrossMarginPct.toFixed(1)}%)` : ''
              }`,
              styles: { fontStyle: 'bold', fontSize: 11, textColor: r.current.adjustedGrossMargin >= 0 ? GOOD : BAD },
            },
          ],
        ],
        theme: 'plain',
        styles: { fontSize: 10, cellPadding: 2.4 },
        columnStyles: { 0: { cellWidth: usableWidth - 50 }, 1: { halign: 'right', cellWidth: 50 } },
      })
      y = doc.lastAutoTable.finalY + 10

      // ---- Sales & Channel Performance ----
      sectionTitle('Sales & Channel Performance')
      if (growthValue != null) {
        ensureSpace(22)
        const growthColor = growthValue >= 0 ? GOOD : BAD
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(20)
        const pctText = fmtPct(growthPct)
        const pctTextWidth = doc.getTextWidth(pctText)
        const triSize = 6.5
        const blockWidth = triSize + 3 + pctTextWidth
        const blockStartX = pageWidth / 2 - blockWidth / 2
        // Standard PDF fonts don't cover unicode arrow glyphs (renders as
        // garbage, e.g. "%2") -- draw the up/down indicator as an actual
        // vector triangle instead of a text character.
        doc.setFillColor(...growthColor)
        if (growthValue >= 0) {
          doc.triangle(blockStartX, y, blockStartX + triSize, y, blockStartX + triSize / 2, y - triSize, 'F')
        } else {
          doc.triangle(blockStartX, y - triSize, blockStartX + triSize, y - triSize, blockStartX + triSize / 2, y, 'F')
        }
        doc.setTextColor(...growthColor)
        doc.text(pctText, blockStartX + triSize + 3, y, { align: 'left' })
        y += 7.5
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(11)
        doc.text(`Sales ${growthValue >= 0 ? 'up' : 'down'} ${formatMoney(Math.abs(growthValue))} vs ${monthLabel(prevY, prevM)}`, pageWidth / 2, y, {
          align: 'center',
        })
        doc.setTextColor(20, 20, 20)
        y += 10
      }

      if (chartRef.current) {
        try {
          const canvas = await html2canvas(chartRef.current, { scale: 2, backgroundColor: '#ffffff' })
          const imgData = canvas.toDataURL('image/png')
          const imgWidth = usableWidth
          const imgHeight = imgWidth * (canvas.height / canvas.width)
          ensureSpace(imgHeight + 6)
          doc.addImage(imgData, 'PNG', marginX, y, imgWidth, imgHeight)
          y += imgHeight + 8
        } catch {
          // Chart capture is best-effort -- the table below still has every number.
        }
      }

      autoTable(doc, {
        startY: y,
        margin: { left: marginX, right: marginX },
        head: [['Sales Channel', 'Previous Month', 'Current Month', 'Difference', '% Change', 'Contribution %']],
        body: r.channelAnalysis.rows.map((c) => [
          c.channel,
          formatMoney(c.previous),
          formatMoney(c.current),
          formatMoney(c.change),
          fmtPct(c.pctChange),
          c.contributionPct != null ? `${c.contributionPct.toFixed(1)}%` : 'N/A',
        ]),
        styles: { fontSize: 9 },
        headStyles: { fillColor: BRAND },
      })
      y = doc.lastAutoTable.finalY + 6

      const insightLines = []
      if (r.channelAnalysis.best) insightLines.push(`Best Performing Channel: ${r.channelAnalysis.best.channel} (${fmtPct(r.channelAnalysis.best.pctChange)})`)
      if (r.channelAnalysis.weakest) insightLines.push(`Weakest Growth: ${r.channelAnalysis.weakest.channel} (${fmtPct(r.channelAnalysis.weakest.pctChange)})`)
      if (r.channelAnalysis.topContributor)
        insightLines.push(`Largest Revenue Contributor: ${r.channelAnalysis.topContributor.channel} (${r.channelAnalysis.topContributor.contributionPct?.toFixed(1)}% of total sales)`)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9.5)
      doc.setTextColor(20, 20, 20)
      insightLines.forEach((t) => {
        ensureSpace(5.5)
        doc.setFillColor(20, 20, 20)
        doc.circle(marginX + 0.8, y - 1.4, 0.8, 'F')
        doc.text(t, marginX + 4, y)
        y += 5.2
      })
      y += 5

      // ---- Next Month Target ----
      sectionTitle(`${monthLabel(nextY, nextM)} Target`)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9)
      const targetNote = doc.splitTextToSize(
        `Set at ${r.nextMonthTarget.pct}% growth over ${monthLabel(year, month)}'s actual sales, split across channels using each channel's own ${monthLabel(year, month)} sales as its base.`,
        usableWidth
      )
      ensureSpace(targetNote.length * 4.5 + 4)
      doc.text(targetNote, marginX, y)
      y += targetNote.length * 4.5 + 4

      kpiRow([
        { label: `${monthLabel(year, month)} Sales (Base)`, value: formatMoney(r.nextMonthTarget.currentSales) },
        { label: `Target (${r.nextMonthTarget.pct}%)`, value: formatMoney(r.nextMonthTarget.target) },
      ])

      autoTable(doc, {
        startY: y,
        margin: { left: marginX, right: marginX },
        head: [['Channel', `${monthLabel(year, month)} Sales`, `Target (${r.nextMonthTarget.pct}%)`]],
        body: r.nextMonthTarget.channels.map((c) => [c.channel, formatMoney(c.currentSales), formatMoney(c.target)]),
        styles: { fontSize: 9 },
        headStyles: { fillColor: BRAND },
      })

      // ---- Footer: page numbers on every page ----
      const pageCount = doc.internal.getNumberOfPages()
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i)
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(8)
        doc.setTextColor(140, 140, 140)
        doc.text(`${COMPANY.name} — Confidential`, marginX, pageHeight - 10)
        doc.text(`Page ${i} of ${pageCount}`, pageWidth - marginX, pageHeight - 10, { align: 'right' })
      }

      doc.save(`month-end-report-gp-${year}-${String(month).padStart(2, '0')}.pdf`)
    } catch (e) {
      setPdfError(e.message || 'Failed to generate PDF.')
    }
    setDownloadingPdf(false)
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
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.5rem' }}>
            <button className="btn" onClick={downloadPdf} disabled={!r || downloadingPdf}>
              {downloadingPdf ? 'Building PDF…' : 'Download PDF'}
            </button>
            <button className="btn-secondary" onClick={() => window.print()} disabled={!r}>
              Print
            </button>
          </div>
        </div>
      </div>

      {error && <div className="inline-error">{error}</div>}
      {pdfError && <div className="inline-error no-print">PDF generation failed: {pdfError}</div>}
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

          {/* ==================== PERFORMANCE SUMMARY ==================== */}
          <h2>Performance Summary</h2>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {r.highlights.lines.map((line, i) => (
              <li
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '0.6rem',
                  fontSize: '1.35rem',
                  fontWeight: 700,
                  lineHeight: 1.5,
                  marginBottom: '0.75rem',
                  color: line.tone === 'good' ? 'var(--success)' : line.tone === 'bad' ? 'var(--danger)' : 'inherit',
                }}
              >
                <span aria-hidden="true" style={{ fontSize: '1.1rem', marginTop: '0.15rem' }}>●</span>
                <span>{line.text}</span>
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

          <div ref={chartRef} className="no-print" style={{ maxWidth: 760, margin: '0 auto', background: '#fff' }}>
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
                <strong>Weakest Growth:</strong> {r.channelAnalysis.weakest.channel} ({fmtPct(r.channelAnalysis.weakest.pctChange)})
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
            Set at {r.nextMonthTarget.pct}% growth over {monthLabel(year, month)}'s actual sales, split across
            channels using each channel's own {monthLabel(year, month)} sales as its base.
          </p>
          <div className="summary-tiles">
            <div className="tile">
              <div className="tile-label">{monthLabel(year, month)} Sales (Base)</div>
              <div className="tile-value">{formatMoney(r.nextMonthTarget.currentSales)}</div>
            </div>
            <div className="tile">
              <div className="tile-label">Target ({r.nextMonthTarget.pct}%)</div>
              <div className="tile-value">{formatMoney(r.nextMonthTarget.target)}</div>
            </div>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Channel</th>
                <th>{monthLabel(year, month)} Sales</th>
                <th>Target ({r.nextMonthTarget.pct}%)</th>
              </tr>
            </thead>
            <tbody>
              {r.nextMonthTarget.channels.map((c) => (
                <tr key={c.channel}>
                  <td>{c.channel}</td>
                  <td>{formatMoney(c.currentSales)}</td>
                  <td>{formatMoney(c.target)}</td>
                </tr>
              ))}
              {r.nextMonthTarget.channels.length === 0 && (
                <tr>
                  <td colSpan={3} className="muted">No channel sales this month to base a target on.</td>
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
