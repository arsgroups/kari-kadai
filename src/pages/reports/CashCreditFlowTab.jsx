import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { formatMoney, toISODate } from '../../lib/format'
import { round2 } from '../../lib/gst'
import ExportButtons from '../../components/ExportButtons'
import ReportPrintHeader from '../../components/ReportPrintHeader'

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function currentMonthKey() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function monthLabel(monthKey) {
  const [y, m] = monthKey.split('-').map(Number)
  return `${MONTH_NAMES[m - 1]} ${y}`
}

// Same anchor as Reports -> Bank Balance Ledger -- both reports track the
// same underlying combined cash+bank position, just at different levels of
// detail, so they must start from the same confirmed figure to ever
// reconcile with each other.
const OPENING_MONTH = '2026-08'
const OPENING_BALANCE_AMOUNT = 10000

// Category display order within a single month -- money in, then money out.
const CATEGORY_ORDER = ['Sales', 'Customer Payments', 'Purchases', 'Supplier Payments', 'Daily Expenses', 'Monthly Expenses', 'Partner Payouts']
const OUTFLOW_CATEGORIES = ['Purchases', 'Supplier Payments', 'Daily Expenses', 'Monthly Expenses', 'Partner Payouts']

function sumByMonth(rows, amountFn) {
  const totals = {}
  rows.forEach((r) => {
    const key = r.date.slice(0, 7)
    totals[key] = round2((totals[key] ?? 0) + amountFn(r))
  })
  return totals
}

// Same combined cash+bank scope as Bank Balance Ledger (Capital excluded for
// the same reason -- no reliable cash-vs-non-cash split there), but instead
// of one row per individual transaction, each MONTH gets at most one row per
// category -- that month's total Sales, total Purchases, total Daily
// Expenses, etc. -- so a year of activity reads as a handful of lines. The
// two reports' closing balance for the same cut-off date always agrees;
// this one is just a coarser view of the same numbers.
//
// Outstanding Receivable is a different kind of figure entirely -- not a
// cash movement, but a snapshot of what customers still owe right now. It
// reuses v_customer_outstanding (the same view Customers -> Outstanding is
// built on): per customer, sum of invoice balances minus all payments ever
// received from them. A raw sum of sale_invoices.balance alone would double
// count -- that column only reflects what was paid AT the time the invoice
// was raised and is never updated when a later customer_payments row
// settles it, so an invoice paid off in full afterwards would still show as
// outstanding.
export default function CashCreditFlowTab() {
  const [fromMonth, setFromMonth] = useState(OPENING_MONTH)
  const [toMonth, setToMonth] = useState(currentMonthKey())
  const [allEntries, setAllEntries] = useState([])
  const [outstandingReceivable, setOutstandingReceivable] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    const [
      { data: salesRows },
      { data: customerPaymentRows },
      { data: purchaseRows },
      { data: supplierPaymentRows },
      { data: expenseRows },
      { data: partnerPayoutRows },
      { data: outstandingRows },
    ] = await Promise.all([
      supabase.from('sale_invoices').select('date, total').in('payment_type', ['Cash', 'Bank']),
      supabase.from('customer_payments').select('date, amount'),
      supabase.from('purchase_invoices').select('date, total').in('payment_type', ['Cash', 'Bank']),
      supabase.from('supplier_payments').select('date, amount'),
      supabase.from('expenses').select('date, scope, amount').eq('entry_type', 'expense'),
      supabase.from('partner_payouts').select('date, amount'),
      supabase.from('v_customer_outstanding').select('outstanding').gt('outstanding', 0),
    ])

    setOutstandingReceivable(round2((outstandingRows ?? []).reduce((s, r) => s + Number(r.outstanding), 0)))

    const dailyExpenseRows = (expenseRows ?? []).filter((e) => e.scope === 'daily')
    const monthlyExpenseRows = (expenseRows ?? []).filter((e) => e.scope !== 'daily')

    const byCategory = {
      Sales: sumByMonth(salesRows ?? [], (r) => r.total),
      'Customer Payments': sumByMonth(customerPaymentRows ?? [], (r) => r.amount),
      Purchases: sumByMonth(purchaseRows ?? [], (r) => r.total),
      'Supplier Payments': sumByMonth(supplierPaymentRows ?? [], (r) => r.amount),
      'Daily Expenses': sumByMonth(dailyExpenseRows, (r) => r.amount),
      'Monthly Expenses': sumByMonth(monthlyExpenseRows, (r) => r.amount),
      'Partner Payouts': sumByMonth(partnerPayoutRows ?? [], (r) => r.amount),
    }

    const entries = []
    CATEGORY_ORDER.forEach((category) => {
      Object.entries(byCategory[category]).forEach(([month, amount]) => {
        if (!amount) return
        const isOutflow = OUTFLOW_CATEGORIES.includes(category)
        entries.push({
          month,
          type: category,
          particulars: `${category} — ${monthLabel(month)} (consolidated)`,
          debit: isOutflow ? 0 : amount,
          credit: isOutflow ? amount : 0,
        })
      })
    })

    const sorted = entries
      .filter((e) => e.month >= OPENING_MONTH)
      .sort((a, b) => a.month.localeCompare(b.month) || CATEGORY_ORDER.indexOf(a.type) - CATEGORY_ORDER.indexOf(b.type))

    let running = OPENING_BALANCE_AMOUNT
    const withBalance = sorted.map((e) => {
      running = round2(running + (e.debit || 0) - (e.credit || 0))
      return { ...e, balance: running }
    })

    setAllEntries(withBalance)
    setLoading(false)
  }

  const { openingBalance, rows, closingBalance, totalReceipts, totalPayments } = useMemo(() => {
    const before = allEntries.filter((e) => e.month < fromMonth)
    const inRange = allEntries.filter((e) => e.month >= fromMonth && e.month <= toMonth)
    const opening = before.length ? before[before.length - 1].balance : OPENING_BALANCE_AMOUNT
    const closing = inRange.length ? inRange[inRange.length - 1].balance : opening
    const receipts = round2(inRange.reduce((sum, e) => sum + (e.debit || 0), 0))
    const payments = round2(inRange.reduce((sum, e) => sum + (e.credit || 0), 0))
    return { openingBalance: opening, rows: inRange, closingBalance: closing, totalReceipts: receipts, totalPayments: payments }
  }, [allEntries, fromMonth, toMonth])

  const exportRows = [
    { month: monthLabel(fromMonth), type: '', particulars: 'Opening Balance', debit: null, credit: null, balance: openingBalance },
    ...rows.map((r) => ({
      month: monthLabel(r.month),
      type: r.type,
      particulars: r.particulars,
      debit: r.debit || null,
      credit: r.credit || null,
      balance: r.balance,
    })),
  ]

  return (
    <div>
      <ReportPrintHeader title="Cash Credit Flow" />
      <div className="card">
        <p className="muted" style={{ fontSize: '0.85rem', marginTop: 0 }}>
          Same combined cash + bank position as Bank Balance Ledger, consolidated to one line per category per
          month instead of one line per transaction — Sales (Cash &amp; Bank), Customer Payments received,
          Purchases, Supplier Payments, Daily Expenses, Monthly Expenses, and Partner Payouts. Capital is
          excluded for the same reason as Bank Balance Ledger, and the ledger starts from the same confirmed
          opening balance of {formatMoney(OPENING_BALANCE_AMOUNT)} as of {monthLabel(OPENING_MONTH)}.
        </p>
        <div className="form-grid">
          <label>
            From Month
            <input type="month" value={fromMonth} onChange={(e) => setFromMonth(e.target.value)} />
          </label>
          <label>
            To Month
            <input type="month" value={toMonth} onChange={(e) => setToMonth(e.target.value)} />
          </label>
        </div>
      </div>

      {loading ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <div className="card" style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
            <div>
              <div className="muted" style={{ fontSize: '0.8rem' }}>
                Opening Balance
              </div>
              <strong style={{ fontSize: '1.1rem' }}>{formatMoney(openingBalance)}</strong>
            </div>
            <div>
              <div className="muted" style={{ fontSize: '0.8rem' }}>
                Total Receipts
              </div>
              <strong style={{ fontSize: '1.1rem' }}>{formatMoney(totalReceipts)}</strong>
            </div>
            <div>
              <div className="muted" style={{ fontSize: '0.8rem' }}>
                Total Payments
              </div>
              <strong style={{ fontSize: '1.1rem' }}>{formatMoney(totalPayments)}</strong>
            </div>
            <div>
              <div className="muted" style={{ fontSize: '0.8rem' }}>
                Closing Balance
              </div>
              <strong style={{ fontSize: '1.1rem' }}>{formatMoney(closingBalance)}</strong>
            </div>
            <div>
              <div className="muted" style={{ fontSize: '0.8rem' }}>
                Outstanding
              </div>
              <strong style={{ fontSize: '1.1rem', color: outstandingReceivable > 0 ? 'var(--warning)' : undefined }}>
                {formatMoney(outstandingReceivable)}
              </strong>
            </div>
          </div>

          <div className="toolbar">
            <ExportButtons
              title="Cash Credit Flow"
              filename="cash_credit_flow"
              columns={[
                { key: 'month', label: 'Month' },
                { key: 'type', label: 'Category' },
                { key: 'particulars', label: 'Particulars' },
                { key: 'debit', label: 'Receipts (Dr)', money: true },
                { key: 'credit', label: 'Payments (Cr)', money: true },
                { key: 'balance', label: 'Balance', money: true },
              ]}
              rows={exportRows}
            />
          </div>

          <div className="card">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Category</th>
                  <th>Particulars</th>
                  <th>Receipts (Dr)</th>
                  <th>Payments (Cr)</th>
                  <th>Balance</th>
                </tr>
              </thead>
              <tbody>
                <tr style={{ fontWeight: 700 }}>
                  <td>{monthLabel(fromMonth)}</td>
                  <td></td>
                  <td>Opening Balance</td>
                  <td>—</td>
                  <td>—</td>
                  <td>{formatMoney(openingBalance)}</td>
                </tr>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td>{monthLabel(r.month)}</td>
                    <td>
                      <span className={r.debit ? 'tag tag-success' : 'tag tag-warning'}>{r.type}</span>
                    </td>
                    <td>{r.particulars}</td>
                    <td>{r.debit ? formatMoney(r.debit) : '—'}</td>
                    <td>{r.credit ? formatMoney(r.credit) : '—'}</td>
                    <td>{formatMoney(r.balance)}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="muted">
                      No activity in this range.
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr style={{ fontWeight: 700 }}>
                  <td colSpan={3}>Closing Balance</td>
                  <td>{formatMoney(totalReceipts)}</td>
                  <td>{formatMoney(totalPayments)}</td>
                  <td>{formatMoney(closingBalance)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
