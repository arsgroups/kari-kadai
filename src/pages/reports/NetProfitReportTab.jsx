import { useEffect, useState } from 'react'
import { fetchMonthEndRawData } from '../../lib/monthEndReportData'
import { computeMonthEndReport } from '../../lib/monthEndReport'
import { formatMoney } from '../../lib/format'
import { round2 } from '../../lib/gst'
import { COMPANY } from '../../lib/companyInfo'
import ReportPrintHeader from '../../components/ReportPrintHeader'

const BRAND = [122, 31, 31]

// How Profit is split between partners. Percentages must add up to 100 --
// change here to adjust the split (or add/remove partners).
const PARTNER_SHARES = [
  { label: 'Partner 1', pct: 50 },
  { label: 'Partner 2', pct: 25 },
  { label: 'Partner 3', pct: 25 },
]

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function monthLabel(year, month) {
  return `${MONTH_NAMES[month - 1]} ${year}`
}

// An expense a partner personally covered out of their own capital (instead
// of company cash/bank) -- flagged by typing this into the expense's
// Remarks field. It still counts as a normal P&L expense (reduces Profit
// exactly like any other expense), but the partner who fronted it is owed
// that amount back -- so it's added on top of their normal Profit share in
// the Partner Share table below, not subtracted a second time anywhere.
function isCapitalRefund(line) {
  return /paid via capital/i.test(line.remarks || '')
}

// A "month-end" report is normally run once that month has actually
// closed -- default to the last full month rather than the current
// (likely still in-progress) one.
function defaultReportMonth() {
  const now = new Date()
  const currentMonth = now.getMonth() + 1
  return currentMonth === 1 ? { year: now.getFullYear() - 1, month: 12 } : { year: now.getFullYear(), month: currentMonth - 1 }
}

// Starts from the same Profit & Loss Statement as Reports -> Month End
// Report (GP) -- Revenue, COGS, Gross Profit, Daily Expenses, Managing
// Partner Salary, Gross Profit Margin -- then continues past it: Monthly
// Expenses, down to a true Profit, split per PARTNER_SHARES. "Monthly
// Expenses" here deliberately includes Fixed Asset / Capex spend too
// (unlike Month End Report (GP), which keeps them separate) -- Profit is
// recomputed locally as Gross Profit Margin minus that combined total,
// rather than reusing current.profitAfterFee/finalNetProfit (which follow
// the GP report's Fixed-Asset-excluded definition and would otherwise
// disagree with what's shown here). Any monthly expense remarked "Paid via
// Capital" is still counted normally against Profit, but is also refunded
// back to partners (split the same way) in the Partner Share table, since
// that money was personally fronted rather than truly spent by the
// business -- see isCapitalRefund().
export default function NetProfitReportTab() {
  const [year, setYear] = useState(defaultReportMonth().year)
  const [month, setMonth] = useState(defaultReportMonth().month)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [report, setReport] = useState(null)
  const [pdfError, setPdfError] = useState('')
  const [downloadingPdf, setDownloadingPdf] = useState(false)

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
  const monthlyLinesCombined = r
    ? [...r.current.monthlyExpenseLines, ...r.current.fixedAssetLines].sort((a, b) => a.date.localeCompare(b.date))
    : []
  const monthlyTotalCombined = r ? round2(r.current.monthlyExpenses + r.current.fixedAssetExpenses) : null
  const netProfit = r ? round2(r.current.adjustedGrossMargin - monthlyTotalCombined) : null
  const capitalRefundTotal = round2(monthlyLinesCombined.filter(isCapitalRefund).reduce((sum, l) => sum + l.amount, 0))

  async function downloadPdf() {
    if (!report) return
    setDownloadingPdf(true)
    setPdfError('')
    try {
      const [{ default: jsPDF }, autoTableModule] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
      const autoTable = autoTableModule.default

      const doc = new jsPDF()
      const pageWidth = doc.internal.pageSize.getWidth()
      const pageHeight = doc.internal.pageSize.getHeight()
      const marginX = 14
      const usableWidth = pageWidth - marginX * 2
      // Every table's rightmost (Amount) column uses this same fixed width,
      // so every number in the document lines up at the same right edge
      // regardless of which table it's in.
      const AMOUNT_W = 40
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
      doc.text('PROFIT REPORT', pageWidth / 2, y, { align: 'center' })
      y += 6.5
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(11)
      doc.text(`Reporting Period: ${monthLabel(year, month)}`, pageWidth / 2, y, { align: 'center' })
      y += 5
      doc.setFontSize(9)
      doc.setTextColor(110, 110, 110)
      doc.text(`Prepared ${new Date().toLocaleString('en-SG')}`, pageWidth / 2, y, { align: 'center' })
      y += 5
      doc.setFont('helvetica', 'italic')
      doc.setFontSize(8)
      doc.text('Confidential — prepared for internal management and stakeholder review only.', pageWidth / 2, y, { align: 'center' })
      doc.setTextColor(20, 20, 20)
      y += 11

      // ---- Profit & Loss Statement (same as Month End Report (GP)) ----
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
            { content: '= Gross Profit Margin', styles: { fontStyle: 'bold' } },
            {
              content: `${formatMoney(r.current.adjustedGrossMargin)}${
                r.current.adjustedGrossMarginPct != null ? ` (${r.current.adjustedGrossMarginPct.toFixed(1)}%)` : ''
              }`,
              styles: { fontStyle: 'bold' },
            },
          ],
        ],
        theme: 'plain',
        styles: { fontSize: 10, cellPadding: 2.4 },
        columnStyles: { 0: { cellWidth: usableWidth - AMOUNT_W }, 1: { halign: 'right', cellWidth: AMOUNT_W } },
      })
      y = doc.lastAutoTable.finalY + 10

      // ---- Monthly Expenses (Category, Description, Amount only -- includes
      // Fixed Asset / Capex spend too, unlike Month End Report (GP)) ----
      sectionTitle('Monthly Expenses')
      autoTable(doc, {
        startY: y,
        margin: { left: marginX, right: marginX },
        head: [['Category', 'Description', 'Amount']],
        body: monthlyLinesCombined.map((l) => [
          l.category,
          isCapitalRefund(l) ? `${l.description || '—'}  [Paid via Capital]` : l.description || '—',
          formatMoney(l.amount),
        ]),
        foot: [[{ content: 'Total Monthly Expenses', colSpan: 2 }, formatMoney(monthlyTotalCombined)]],
        styles: { fontSize: 9.5 },
        headStyles: { fillColor: BRAND },
        footStyles: { fontStyle: 'bold', fillColor: [245, 240, 235], textColor: [20, 20, 20] },
        columnStyles: { 0: { cellWidth: 40 }, 2: { halign: 'right', cellWidth: AMOUNT_W } },
      })
      if (monthlyLinesCombined.length === 0) {
        doc.setFont('helvetica', 'italic')
        doc.setFontSize(9)
        doc.setTextColor(120, 120, 120)
        doc.text('No monthly expenses recorded this month.', marginX, doc.lastAutoTable.finalY + 6)
        doc.setTextColor(20, 20, 20)
      }
      y = doc.lastAutoTable.finalY + 10

      // ---- Profit ----
      sectionTitle('Profit')
      autoTable(doc, {
        startY: y,
        margin: { left: marginX, right: marginX },
        body: [
          ['Gross Profit Margin', formatMoney(r.current.adjustedGrossMargin)],
          ['− Monthly Expenses', formatMoney(monthlyTotalCombined)],
          [
            { content: '= Profit', styles: { fontStyle: 'bold', fontSize: 12 } },
            {
              content: formatMoney(netProfit),
              styles: { fontStyle: 'bold', fontSize: 12, textColor: netProfit >= 0 ? [26, 127, 55] : [192, 57, 43] },
            },
          ],
        ],
        theme: 'plain',
        styles: { fontSize: 10, cellPadding: 2.4 },
        columnStyles: { 0: { cellWidth: usableWidth - AMOUNT_W }, 1: { halign: 'right', cellWidth: AMOUNT_W } },
      })
      y = doc.lastAutoTable.finalY + 10

      // ---- Partner Share ----
      sectionTitle('Partner Share')
      if (capitalRefundTotal > 0) {
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(8.5)
        doc.setTextColor(110, 110, 110)
        const refundNote = doc.splitTextToSize(
          `${formatMoney(capitalRefundTotal)} of this month's expenses were paid via a partner's own capital (tagged "Paid via Capital" above) -- already counted normally as an expense against Profit, and refunded back here on top of each partner's Profit share, split the same way.`,
          usableWidth
        )
        doc.text(refundNote, marginX, y)
        y += refundNote.length * 4 + 4
        doc.setTextColor(20, 20, 20)
      }
      autoTable(doc, {
        startY: y,
        margin: { left: marginX, right: marginX },
        head:
          capitalRefundTotal > 0
            ? [['Partner', 'Share %', 'Profit Share', 'Capital Refund', 'Total Payout']]
            : [['Partner', 'Share %', 'Profit Share']],
        body: PARTNER_SHARES.map((p) => {
          const profitShare = round2(netProfit * (p.pct / 100))
          if (capitalRefundTotal <= 0) return [p.label, `${p.pct}%`, formatMoney(profitShare)]
          const capitalShare = round2(capitalRefundTotal * (p.pct / 100))
          return [
            p.label,
            `${p.pct}%`,
            formatMoney(profitShare),
            formatMoney(capitalShare),
            { content: formatMoney(round2(profitShare + capitalShare)), styles: { fontStyle: 'bold' } },
          ]
        }),
        styles: { fontSize: 9.5 },
        headStyles: { fillColor: BRAND },
        columnStyles:
          capitalRefundTotal > 0
            ? { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right', cellWidth: AMOUNT_W } }
            : { 2: { halign: 'right', cellWidth: AMOUNT_W } },
      })
      y = doc.lastAutoTable.finalY + 4

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

      doc.save(`profit-report-${year}-${String(month).padStart(2, '0')}.pdf`)
    } catch (e) {
      setPdfError(e.message || 'Failed to generate PDF.')
    }
    setDownloadingPdf(false)
  }

  return (
    <div>
      <ReportPrintHeader title={r ? `Profit Report — ${monthLabel(year, month)}` : 'Profit Report'} />

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
          <h1 style={{ marginBottom: 0 }}>Profit Report</h1>
          <p className="muted" style={{ marginTop: '0.2rem' }}>
            Reporting Period: <strong>{monthLabel(year, month)}</strong> · Prepared {new Date().toLocaleString('en-SG')}
          </p>
          <p className="muted" style={{ fontSize: '0.8rem' }}>Confidential — prepared for internal management and stakeholder review only.</p>

          {/* ==================== P&L STATEMENT (same as Month End Report (GP)) ==================== */}
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
              <tr style={{ fontWeight: 700 }}>
                <td>= Gross Profit Margin</td>
                <td>
                  {formatMoney(r.current.adjustedGrossMargin)}
                  {r.current.adjustedGrossMarginPct != null && ` (${r.current.adjustedGrossMarginPct.toFixed(1)}%)`}
                </td>
              </tr>
            </tbody>
          </table>

          {/* ==================== MONTHLY EXPENSES ==================== */}
          <h2>Monthly Expenses</h2>
          <table className="data-table" style={{ maxWidth: 560 }}>
            <thead>
              <tr>
                <th>Category</th>
                <th>Description</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {monthlyLinesCombined.map((l, i) => (
                <tr key={i}>
                  <td>{l.category}</td>
                  <td>
                    {l.description || '—'}
                    {isCapitalRefund(l) && (
                      <span className="tag tag-warning" style={{ marginLeft: '0.4rem' }}>
                        Paid via Capital
                      </span>
                    )}
                  </td>
                  <td>{formatMoney(l.amount)}</td>
                </tr>
              ))}
              {monthlyLinesCombined.length === 0 && (
                <tr>
                  <td colSpan={3} className="muted">No monthly expenses recorded this month.</td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 700 }}>
                <td colSpan={2}>Total Monthly Expenses</td>
                <td>{formatMoney(monthlyTotalCombined)}</td>
              </tr>
            </tfoot>
          </table>

          {/* ==================== PROFIT ==================== */}
          <h2>Profit</h2>
          <table className="data-table" style={{ maxWidth: 560 }}>
            <tbody>
              <tr>
                <td>Gross Profit Margin</td>
                <td>{formatMoney(r.current.adjustedGrossMargin)}</td>
              </tr>
              <tr>
                <td>− Monthly Expenses</td>
                <td>{formatMoney(monthlyTotalCombined)}</td>
              </tr>
              <tr style={{ fontWeight: 700, fontSize: '1.1rem' }}>
                <td>= Profit</td>
                <td>
                  <span className={netProfit >= 0 ? 'tag tag-success' : 'tag tag-danger'}>{formatMoney(netProfit)}</span>
                </td>
              </tr>
            </tbody>
          </table>

          {/* ==================== PARTNER SHARE ==================== */}
          <h2>Partner Share</h2>
          {capitalRefundTotal > 0 && (
            <p className="muted" style={{ fontSize: '0.8rem' }}>
              {formatMoney(capitalRefundTotal)} of this month's expenses were paid via a partner's own capital
              (tagged "Paid via Capital" above) — already counted normally as an expense against Profit, and
              refunded back here on top of each partner's Profit share, split the same way.
            </p>
          )}
          <table className="data-table" style={{ maxWidth: capitalRefundTotal > 0 ? 640 : 480 }}>
            <thead>
              <tr>
                <th>Partner</th>
                <th>Share %</th>
                <th>Profit Share</th>
                {capitalRefundTotal > 0 && (
                  <>
                    <th>Capital Refund</th>
                    <th>Total Payout</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {PARTNER_SHARES.map((p) => {
                const profitShare = netProfit != null ? round2(netProfit * (p.pct / 100)) : null
                const capitalShare = round2(capitalRefundTotal * (p.pct / 100))
                return (
                  <tr key={p.label}>
                    <td>{p.label}</td>
                    <td>{p.pct}%</td>
                    <td>{profitShare != null ? formatMoney(profitShare) : ''}</td>
                    {capitalRefundTotal > 0 && (
                      <>
                        <td>{formatMoney(capitalShare)}</td>
                        <td style={{ fontWeight: 700 }}>
                          {profitShare != null ? formatMoney(round2(profitShare + capitalShare)) : ''}
                        </td>
                      </>
                    )}
                  </tr>
                )
              })}
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
