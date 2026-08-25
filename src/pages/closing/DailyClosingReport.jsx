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
      { data: creditPayments },
      { data: purchases },
      { data: expenseRows },
      { data: closingRow },
    ] = await Promise.all([
      supabase
        .from('sale_invoices')
        .select('invoice_number, total, payment_type, channel, customers(name)')
        .eq('date', date),
      supabase
        .from('customer_payments')
        .select('amount, payment_type, note, customers(name), sale_invoices(invoice_number, date)')
        .eq('date', date),
      supabase.from('purchase_invoices').select('invoice_number, total, payment_type, suppliers(name)').eq('date', date),
      supabase
        .from('expenses')
        .select('description, amount, entry_type, expense_categories(name)')
        .eq('date', date)
        .eq('scope', 'daily'),
      supabase.from('daily_closing').select('*').eq('date', date).maybeSingle(),
    ])

    // A payment is "old credit collected" only if it's settling an invoice
    // from a previous day. A Credit invoice raised and paid off on the same
    // day isn't old credit -- it shows as Paid in today's sales instead, and
    // its cash (if any) is still cash in hand today either way.
    const creditPaymentRowsAll = (creditPayments ?? []).map((p) => ({
      ...p,
      customerName: p.customers?.name ?? '—',
      invoiceNumber: p.sale_invoices?.invoice_number ?? '—',
      isSameDay: p.sale_invoices?.date === date,
    }))
    const oldCreditPaymentRows = creditPaymentRowsAll.filter((p) => !p.isSameDay)
    const creditCollectedToday = oldCreditPaymentRows.reduce((sum, p) => sum + p.amount, 0)
    const cashCreditCollected = creditPaymentRowsAll
      .filter((p) => p.payment_type === 'Cash')
      .reduce((sum, p) => sum + p.amount, 0)

    const sameDayPaidByInvoice = {}
    creditPaymentRowsAll
      .filter((p) => p.isSameDay)
      .forEach((p) => {
        sameDayPaidByInvoice[p.invoiceNumber] = (sameDayPaidByInvoice[p.invoiceNumber] ?? 0) + p.amount
      })

    const salesRows = (sales ?? [])
      .map((s) => ({
        ...s,
        customerName: s.customers?.name ?? 'Counter Sale',
        isPaid: s.payment_type !== 'Credit' || (sameDayPaidByInvoice[s.invoice_number] ?? 0) >= s.total - 0.01,
      }))
      .sort((a, b) => a.customerName.localeCompare(b.customerName))
    const cashSales = salesRows.filter((s) => s.payment_type === 'Cash').reduce((sum, s) => sum + s.total, 0)
    const bankSales = salesRows.filter((s) => s.payment_type === 'Bank').reduce((sum, s) => sum + s.total, 0)
    const creditSales = salesRows.filter((s) => s.payment_type === 'Credit').reduce((sum, s) => sum + s.total, 0)
    const totalSales = cashSales + bankSales + creditSales

    const purchaseRows = (purchases ?? []).map((p) => ({ ...p, supplierName: p.suppliers?.name ?? '—' }))
    const totalPurchases = purchaseRows.reduce((sum, p) => sum + p.total, 0)

    const expenseEntries = (expenseRows ?? []).filter((e) => e.entry_type === 'expense')
    const totalExpenses = expenseEntries.reduce((sum, e) => sum + e.amount, 0)

    // Each day starts from zero, not carried forward from yesterday's counted
    // cash -- cash counted is expected to be deposited to the bank (tracked
    // below), not held over as tomorrow's opening balance. Cash physically in
    // the till also includes any old credit collected in cash today, not
    // just today's new Cash-channel sales.
    const expectedCash = cashSales + cashCreditCollected - totalExpenses
    const actualCash = closingRow?.actual_cash_counted ?? null
    const variance = actualCash === null ? null : round2(actualCash - expectedCash)
    const bankDepositAmount = closingRow?.bank_deposit_amount ?? null
    const bankDepositVariance =
      actualCash === null || bankDepositAmount === null ? null : round2(actualCash - bankDepositAmount)

    setData({
      salesRows,
      cashSales,
      bankSales,
      creditSales,
      totalSales,
      creditPaymentRows: oldCreditPaymentRows,
      creditCollectedToday,
      cashCreditCollected,
      purchaseRows,
      totalPurchases,
      expenseEntries,
      totalExpenses,
      expectedCash,
      actualCash,
      variance,
      bankDepositAmount,
      bankDepositVariance,
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
    doc.text('DAILY REPORT', 14, 31)
    doc.setFontSize(10)
    doc.text(`Date: ${formatDate(date)}`, 14, 38)
    doc.text(`Operator: ${operatorEmail}`, 14, 43)
    doc.text(`Printed on: ${new Date().toLocaleString('en-SG')}`, 14, 48)

    let y = 55
    doc.setFontSize(11)
    doc.text('1. Today\'s Sales by Customer', 14, y)
    autoTable(doc, {
      startY: y + 4,
      head: [['Customer', 'Channel', 'Invoice Total', 'Status']],
      body: data.salesRows.length
        ? data.salesRows.map((s) => [
            s.customerName,
            s.channel,
            formatMoney(s.total),
            s.isPaid ? 'Paid' : 'Credit',
          ])
        : [['No sales recorded', '', '', '']],
      styles: { fontSize: 9 },
      headStyles: { fillColor: [122, 31, 31] },
    })

    y = doc.lastAutoTable.finalY + 8
    doc.setFontSize(11)
    doc.text('2. Old Credit Collected Today', 14, y)
    autoTable(doc, {
      startY: y + 4,
      head: [['Customer', 'Invoice #', 'Method', 'Amount']],
      body: data.creditPaymentRows.length
        ? data.creditPaymentRows.map((p) => [p.customerName, p.invoiceNumber, p.payment_type, formatMoney(p.amount)])
        : [['No credit collected today', '', '', '']],
      styles: { fontSize: 9 },
      headStyles: { fillColor: [122, 31, 31] },
    })

    y = doc.lastAutoTable.finalY + 8
    doc.setFontSize(10)
    doc.text(`Total Credit Collected Today: ${formatMoney(data.creditCollectedToday)}`, 14, y)
    y += 6
    doc.text(`Total Cash from Today's Sales: ${formatMoney(data.cashSales)}`, 14, y)
    y += 5
    doc.text(`Total Bank from Today's Sales: ${formatMoney(data.bankSales)}`, 14, y)
    y += 5
    doc.text(`Total Credit from Today's Sales (still owed): ${formatMoney(data.creditSales)}`, 14, y)
    y += 5
    doc.setFontSize(10.5)
    doc.text(`Total Sales: ${formatMoney(data.totalSales)}`, 14, y)

    y += 9
    doc.setFontSize(11)
    doc.text('3. Today\'s Purchases', 14, y)
    autoTable(doc, {
      startY: y + 4,
      head: [['Supplier', 'Invoice #', 'Amount', 'Status']],
      body: data.purchaseRows.length
        ? data.purchaseRows.map((p) => [
            p.supplierName,
            p.invoice_number,
            formatMoney(p.total),
            p.payment_type === 'Credit' ? 'Credit' : 'Paid',
          ])
        : [['No purchases recorded', '', '', '']],
      styles: { fontSize: 9 },
      headStyles: { fillColor: [122, 31, 31] },
    })
    y = doc.lastAutoTable.finalY + 6
    doc.setFontSize(10.5)
    doc.text(`Total Purchases: ${formatMoney(data.totalPurchases)}`, 14, y)

    y += 9
    doc.setFontSize(11)
    doc.text('4. Cash in Hand', 14, y)
    autoTable(doc, {
      startY: y + 4,
      head: [['Description', 'Category', 'Amount']],
      body: data.expenseEntries.length
        ? data.expenseEntries.map((e) => [e.description || '—', e.expense_categories?.name ?? 'Uncategorized', formatMoney(e.amount)])
        : [['No expenses logged', '', '']],
      styles: { fontSize: 9 },
      headStyles: { fillColor: [122, 31, 31] },
    })
    y = doc.lastAutoTable.finalY + 6
    doc.setFontSize(10)
    doc.text(`Cash Sales Today: ${formatMoney(data.cashSales)}`, 14, y)
    y += 5
    doc.text(`+ Cash Collected from Old Credit Today: ${formatMoney(data.cashCreditCollected)}`, 14, y)
    y += 5
    doc.text(`- Daily Expenses: ${formatMoney(data.totalExpenses)}`, 14, y)
    y += 6
    doc.setFontSize(11)
    doc.text(`= Total Cash in Hand (Expected): ${formatMoney(data.expectedCash)}`, 14, y)
    y += 7
    doc.setFontSize(10)
    doc.text(`Actual Cash Counted: ${data.actualCash === null ? 'Not entered' : formatMoney(data.actualCash)}`, 14, y)
    y += 5
    doc.text(`Variance: ${data.variance === null ? '—' : formatMoney(data.variance)}`, 14, y)
    y += 7
    doc.text(
      `Bank Deposit Amount: ${data.bankDepositAmount === null ? 'Not entered' : formatMoney(data.bankDepositAmount)}`,
      14,
      y
    )
    y += 5
    doc.text(`Bank Deposit Variance: ${data.bankDepositVariance === null ? '—' : formatMoney(data.bankDepositVariance)}`, 14, y)

    doc.save(`daily-report-${date}.pdf`)
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
            <h1 style={{ margin: 0 }}>DAILY REPORT</h1>
            <p style={{ margin: '0.2rem 0' }}>
              Date: <strong>{formatDate(date)}</strong>
            </p>
            <p style={{ margin: '0.2rem 0' }}>Operator: {operatorEmail}</p>
            <p className="muted" style={{ margin: '0.2rem 0', fontSize: '0.85rem' }}>
              Printed on {new Date().toLocaleString('en-SG')}
            </p>
          </div>
        </div>

        <h3>1. Today's Sales by Customer</h3>
        <table className="data-table" style={{ maxWidth: 640 }}>
          <thead>
            <tr>
              <th>Customer</th>
              <th>Channel</th>
              <th>Invoice Total</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {data.salesRows.map((s) => (
              <tr key={s.invoice_number}>
                <td>{s.customerName}</td>
                <td>{s.channel}</td>
                <td>{formatMoney(s.total)}</td>
                <td>
                  <span className={s.isPaid ? 'tag tag-success' : 'tag tag-warning'}>
                    {s.isPaid ? 'Paid' : 'Credit'}
                  </span>
                </td>
              </tr>
            ))}
            {data.salesRows.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  No sales recorded.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <h3>2. Old Credit Collected Today</h3>
        <table className="data-table" style={{ maxWidth: 640 }}>
          <thead>
            <tr>
              <th>Customer</th>
              <th>Invoice #</th>
              <th>Method</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {data.creditPaymentRows.map((p, i) => (
              <tr key={i}>
                <td>{p.customerName}</td>
                <td>{p.invoiceNumber}</td>
                <td>{p.payment_type}</td>
                <td>{formatMoney(p.amount)}</td>
              </tr>
            ))}
            {data.creditPaymentRows.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  No credit collected today.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr style={{ fontWeight: 700 }}>
              <td colSpan={3}>Total Credit Collected Today</td>
              <td>{formatMoney(data.creditCollectedToday)}</td>
            </tr>
          </tfoot>
        </table>

        <table className="data-table" style={{ maxWidth: 480 }}>
          <tbody>
            <tr>
              <td>Total Cash from Today's Sales</td>
              <td>{formatMoney(data.cashSales)}</td>
            </tr>
            <tr>
              <td>Total Bank from Today's Sales</td>
              <td>{formatMoney(data.bankSales)}</td>
            </tr>
            <tr>
              <td>Total Credit from Today's Sales (still owed)</td>
              <td>{formatMoney(data.creditSales)}</td>
            </tr>
            <tr style={{ fontWeight: 700 }}>
              <td>Total Sales</td>
              <td>{formatMoney(data.totalSales)}</td>
            </tr>
          </tbody>
        </table>

        <h3>3. Today's Purchases</h3>
        <table className="data-table" style={{ maxWidth: 640 }}>
          <thead>
            <tr>
              <th>Supplier</th>
              <th>Invoice #</th>
              <th>Amount</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {data.purchaseRows.map((p) => (
              <tr key={p.invoice_number}>
                <td>{p.supplierName}</td>
                <td>{p.invoice_number}</td>
                <td>{formatMoney(p.total)}</td>
                <td>
                  <span className={p.payment_type === 'Credit' ? 'tag tag-warning' : 'tag tag-success'}>
                    {p.payment_type === 'Credit' ? 'Credit' : 'Paid'}
                  </span>
                </td>
              </tr>
            ))}
            {data.purchaseRows.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  No purchases recorded.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr style={{ fontWeight: 700 }}>
              <td colSpan={2}>Total Purchases</td>
              <td colSpan={2}>{formatMoney(data.totalPurchases)}</td>
            </tr>
          </tfoot>
        </table>

        <h3>4. Cash in Hand</h3>
        <p className="muted" style={{ fontSize: '0.8rem', marginTop: '-0.5rem' }}>
          Daily expenses only — recurring monthly bills (Salary, Rent, ...) are tracked separately in the
          P&amp;L report instead.
        </p>
        <table className="data-table" style={{ maxWidth: 640 }}>
          <thead>
            <tr>
              <th>Description</th>
              <th>Category</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {data.expenseEntries.map((e, i) => (
              <tr key={i}>
                <td>{e.description || '—'}</td>
                <td>{e.expense_categories?.name ?? 'Uncategorized'}</td>
                <td>{formatMoney(e.amount)}</td>
              </tr>
            ))}
            {data.expenseEntries.length === 0 && (
              <tr>
                <td colSpan={3} className="muted">
                  No expenses logged.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr style={{ fontWeight: 700 }}>
              <td colSpan={2}>Total Daily Expenses</td>
              <td>{formatMoney(data.totalExpenses)}</td>
            </tr>
          </tfoot>
        </table>

        <table className="data-table" style={{ maxWidth: 480, marginTop: '1rem' }}>
          <tbody>
            <tr>
              <td>Cash Sales Today</td>
              <td>{formatMoney(data.cashSales)}</td>
            </tr>
            <tr>
              <td>+ Cash Collected from Old Credit Today</td>
              <td>{formatMoney(data.cashCreditCollected)}</td>
            </tr>
            <tr>
              <td>− Daily Expenses</td>
              <td>{formatMoney(data.totalExpenses)}</td>
            </tr>
            <tr style={{ fontWeight: 700 }}>
              <td>= Total Cash in Hand (Expected)</td>
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
            <tr>
              <td>Bank Deposit Amount</td>
              <td>{data.bankDepositAmount === null ? 'Not entered yet' : formatMoney(data.bankDepositAmount)}</td>
            </tr>
            <tr style={{ fontWeight: 700 }}>
              <td>Bank Deposit Variance</td>
              <td>
                {data.bankDepositVariance === null ? (
                  '—'
                ) : (
                  <span className={data.bankDepositVariance === 0 ? 'tag tag-success' : 'tag tag-danger'}>
                    {formatMoney(data.bankDepositVariance)}
                  </span>
                )}
              </td>
            </tr>
          </tbody>
        </table>

        <div className="invoice-footer">
          <p className="muted">Generated by {COMPANY.name}</p>
        </div>
      </div>
    </div>
  )
}
