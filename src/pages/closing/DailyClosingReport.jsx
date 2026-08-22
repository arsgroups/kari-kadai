import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { formatDate, formatMoney } from '../../lib/format'
import { COMPANY } from '../../lib/companyInfo'
import { round2 } from '../../lib/gst'

export default function DailyClosingReport({ date, operatorEmail, onClose }) {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState(null)

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date])

  async function load() {
    setLoading(true)
    const [
      { data: sales },
      { data: purchases },
      { data: expenseRows },
      { data: closingRow },
      { data: prevClosing },
      { data: outstandingRows },
      { data: payments },
    ] = await Promise.all([
      supabase.from('sale_invoices').select('total, subtotal, payment_type, channel').eq('date', date),
      supabase.from('purchase_invoices').select('total, subtotal').eq('date', date),
      supabase
        .from('expenses')
        .select('amount, entry_type, expense_categories(name)')
        .eq('date', date)
        .eq('scope', 'daily'),
      supabase.from('daily_closing').select('*').eq('date', date).maybeSingle(),
      supabase
        .from('daily_closing')
        .select('actual_cash_counted')
        .lt('date', date)
        .order('date', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.from('v_customer_outstanding').select('outstanding'),
      supabase.from('customer_payments').select('amount').eq('date', date),
    ])

    const salesRows = sales ?? []
    const cashSales = salesRows.filter((s) => s.payment_type === 'Cash').reduce((sum, s) => sum + s.total, 0)
    const bankSales = salesRows.filter((s) => s.payment_type === 'Bank').reduce((sum, s) => sum + s.total, 0)
    const creditSales = salesRows.filter((s) => s.payment_type === 'Credit').reduce((sum, s) => sum + s.total, 0)
    const totalSales = cashSales + bankSales + creditSales

    const byChannel = {}
    salesRows.forEach((s) => {
      byChannel[s.channel] = (byChannel[s.channel] ?? 0) + s.total
    })

    const purchaseRows = purchases ?? []
    const totalPurchases = purchaseRows.reduce((sum, p) => sum + p.total, 0)

    const expenseEntries = (expenseRows ?? []).filter((e) => e.entry_type === 'expense')
    const totalExpenses = expenseEntries.reduce((sum, e) => sum + e.amount, 0)
    const byCategory = {}
    expenseEntries.forEach((e) => {
      const name = e.expense_categories?.name ?? 'Uncategorized'
      byCategory[name] = (byCategory[name] ?? 0) + e.amount
    })

    const openingCash = prevClosing?.actual_cash_counted ?? 0
    const expectedCash = openingCash + cashSales - totalExpenses
    const actualCash = closingRow?.actual_cash_counted ?? null
    const variance = actualCash === null ? null : round2(actualCash - expectedCash)

    const totalOutstanding = (outstandingRows ?? []).reduce((sum, r) => sum + r.outstanding, 0)
    const creditCollectedToday = (payments ?? []).reduce((sum, p) => sum + p.amount, 0)

    setData({
      cashSales,
      bankSales,
      creditSales,
      totalSales,
      byChannel,
      totalPurchases,
      totalExpenses,
      byCategory,
      openingCash,
      expectedCash,
      actualCash,
      variance,
      totalOutstanding,
      creditCollectedToday,
    })
    setLoading(false)
  }

  async function downloadPdf() {
    if (!data) return
    const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
      import('jspdf'),
      import('jspdf-autotable'),
    ])
    const doc = new jsPDF()
    doc.setFontSize(16)
    doc.text(COMPANY.name, 14, 18)
    doc.setFontSize(9)
    doc.text(`UEN: ${COMPANY.uen}`, 14, 23)
    doc.setFontSize(12)
    doc.text('DAILY CLOSING REPORT', 14, 31)
    doc.setFontSize(10)
    doc.text(`Date: ${formatDate(date)}`, 14, 38)
    doc.text(`Operator: ${operatorEmail}`, 14, 43)
    doc.text(`Printed on: ${new Date().toLocaleString('en-SG')}`, 14, 48)

    autoTable(doc, {
      startY: 55,
      head: [['Summary', 'Amount (SGD)']],
      body: [
        ['Cash Sales', formatMoney(data.cashSales)],
        ['Bank Sales', formatMoney(data.bankSales)],
        ['Credit Sales', formatMoney(data.creditSales)],
        ['Total Sales', formatMoney(data.totalSales)],
        ['Total Purchases', formatMoney(data.totalPurchases)],
        ['Total Expenses', formatMoney(data.totalExpenses)],
        ['Outstanding Credit (all customers)', formatMoney(data.totalOutstanding)],
        ['Credit Collected Today', formatMoney(data.creditCollectedToday)],
        ['Opening Cash', formatMoney(data.openingCash)],
        ['Expected Cash', formatMoney(data.expectedCash)],
        ['Actual Cash Counted', data.actualCash === null ? 'Not entered' : formatMoney(data.actualCash)],
        ['Variance', data.variance === null ? '—' : formatMoney(data.variance)],
      ],
      styles: { fontSize: 9 },
      headStyles: { fillColor: [122, 31, 31] },
    })

    let y = doc.lastAutoTable.finalY + 8
    doc.setFontSize(11)
    doc.text('Sales Breakdown by Channel', 14, y)
    autoTable(doc, {
      startY: y + 4,
      head: [['Channel', 'Amount']],
      body: Object.entries(data.byChannel).map(([k, v]) => [k, formatMoney(v)]),
      styles: { fontSize: 9 },
      headStyles: { fillColor: [122, 31, 31] },
    })

    y = doc.lastAutoTable.finalY + 8
    doc.setFontSize(11)
    doc.text('Expense Breakdown by Category', 14, y)
    autoTable(doc, {
      startY: y + 4,
      head: [['Category', 'Amount']],
      body:
        Object.entries(data.byCategory).length > 0
          ? Object.entries(data.byCategory).map(([k, v]) => [k, formatMoney(v)])
          : [['No expenses logged', '']],
      styles: { fontSize: 9 },
      headStyles: { fillColor: [122, 31, 31] },
    })

    doc.save(`daily-closing-${date}.pdf`)
  }

  if (loading || !data) return <p className="muted">Loading report…</p>

  return (
    <div>
      <div className="toolbar no-print">
        <button className="btn" onClick={() => window.print()}>
          Print
        </button>
        <button className="btn-secondary" onClick={downloadPdf}>
          Download PDF
        </button>
        {onClose && (
          <button className="btn-secondary" onClick={onClose}>
            Close
          </button>
        )}
      </div>

      <div className="invoice-sheet">
        <div className="invoice-meta-row">
          <div>
            <h2 style={{ margin: 0 }}>{COMPANY.name}</h2>
            <p className="muted" style={{ margin: '0.2rem 0' }}>
              {COMPANY.addressLine1}, {COMPANY.addressLine2}
            </p>
            <p className="muted" style={{ margin: '0.2rem 0', fontSize: '0.8rem' }}>
              UEN: {COMPANY.uen}
            </p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <h1 style={{ margin: 0 }}>DAILY CLOSING REPORT</h1>
            <p style={{ margin: '0.2rem 0' }}>Date: <strong>{formatDate(date)}</strong></p>
            <p style={{ margin: '0.2rem 0' }}>Operator: {operatorEmail}</p>
            <p className="muted" style={{ margin: '0.2rem 0', fontSize: '0.85rem' }}>
              Printed on {new Date().toLocaleString('en-SG')}
            </p>
          </div>
        </div>

        <h3>Summary</h3>
        <p className="muted" style={{ fontSize: '0.8rem', marginTop: '-0.5rem' }}>
          Expenses here cover daily/till spend only — recurring monthly bills (Salary, Rent, ...) are
          tracked separately and included in the P&amp;L report instead.
        </p>
        <table className="data-table" style={{ maxWidth: 480 }}>
          <tbody>
            <tr>
              <td>Cash Sales</td>
              <td>{formatMoney(data.cashSales)}</td>
            </tr>
            <tr>
              <td>Bank Sales</td>
              <td>{formatMoney(data.bankSales)}</td>
            </tr>
            <tr>
              <td>Credit Sales</td>
              <td>{formatMoney(data.creditSales)}</td>
            </tr>
            <tr style={{ fontWeight: 700 }}>
              <td>Total Sales</td>
              <td>{formatMoney(data.totalSales)}</td>
            </tr>
            <tr>
              <td>Total Purchases</td>
              <td>{formatMoney(data.totalPurchases)}</td>
            </tr>
            <tr>
              <td>Total Expenses</td>
              <td>{formatMoney(data.totalExpenses)}</td>
            </tr>
          </tbody>
        </table>

        <h3>Outstanding Credit</h3>
        <table className="data-table" style={{ maxWidth: 480 }}>
          <tbody>
            <tr>
              <td>Outstanding Credit (all customers, as of today)</td>
              <td>{formatMoney(data.totalOutstanding)}</td>
            </tr>
            <tr>
              <td>Credit Collected Today</td>
              <td>{formatMoney(data.creditCollectedToday)}</td>
            </tr>
          </tbody>
        </table>

        <h3>Cash Collection</h3>
        <table className="data-table" style={{ maxWidth: 480 }}>
          <tbody>
            <tr>
              <td>Opening Cash</td>
              <td>{formatMoney(data.openingCash)}</td>
            </tr>
            <tr>
              <td>Expected Closing Cash</td>
              <td>{formatMoney(data.expectedCash)}</td>
            </tr>
            <tr>
              <td>Actual Cash Counted</td>
              <td>{data.actualCash === null ? 'Not entered yet' : formatMoney(data.actualCash)}</td>
            </tr>
            <tr style={{ fontWeight: 700 }}>
              <td>Variance</td>
              <td>
                {data.variance === null ? (
                  '—'
                ) : (
                  <span className={data.variance === 0 ? 'tag tag-success' : 'tag tag-danger'}>
                    {formatMoney(data.variance)}
                  </span>
                )}
              </td>
            </tr>
          </tbody>
        </table>

        <h3>Sales Breakdown by Channel</h3>
        <table className="data-table" style={{ maxWidth: 480 }}>
          <tbody>
            {Object.entries(data.byChannel).map(([k, v]) => (
              <tr key={k}>
                <td>{k}</td>
                <td>{formatMoney(v)}</td>
              </tr>
            ))}
            {Object.keys(data.byChannel).length === 0 && (
              <tr>
                <td colSpan={2} className="muted">
                  No sales recorded.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <h3>Expense Breakdown by Category</h3>
        <table className="data-table" style={{ maxWidth: 480 }}>
          <tbody>
            {Object.entries(data.byCategory).map(([k, v]) => (
              <tr key={k}>
                <td>{k}</td>
                <td>{formatMoney(v)}</td>
              </tr>
            ))}
            {Object.keys(data.byCategory).length === 0 && (
              <tr>
                <td colSpan={2} className="muted">
                  No expenses logged.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="invoice-footer">
          <p className="muted">Generated by {COMPANY.name}</p>
        </div>
      </div>
    </div>
  )
}
