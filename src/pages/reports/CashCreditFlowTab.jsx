import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { formatDate, formatMoney, toISODate } from '../../lib/format'
import { round2 } from '../../lib/gst'
import ExportButtons from '../../components/ExportButtons'
import ReportPrintHeader from '../../components/ReportPrintHeader'

function firstOfMonth() {
  const d = new Date()
  return toISODate(new Date(d.getFullYear(), d.getMonth(), 1))
}

// Same anchor as Reports -> Bank Balance Ledger -- both reports track the
// same underlying combined cash+bank position, just at different levels of
// detail, so they must start from the same confirmed figure to ever
// reconcile with each other.
const OPENING_BALANCE_DATE = '2026-08-01'
const OPENING_BALANCE_AMOUNT = 10000

// Category display order within a single day -- money in, then money out.
const CATEGORY_ORDER = ['Sales', 'Customer Payments', 'Purchases', 'Supplier Payments', 'Daily Expenses', 'Monthly Expenses', 'Partner Payouts']

function sumByDate(rows, amountFn) {
  const totals = {}
  rows.forEach((r) => {
    totals[r.date] = round2((totals[r.date] ?? 0) + amountFn(r))
  })
  return totals
}

// Same combined cash+bank scope as Bank Balance Ledger (Capital excluded for
// the same reason -- no reliable cash-vs-non-cash split there), but instead
// of one row per individual transaction, each day gets at most one row per
// category -- the day's total Sales, total Purchases, total Daily Expenses,
// etc. -- so a month of activity reads as a handful of lines instead of
// hundreds. The two reports' closing balance for the same date always
// agrees; this one is just a coarser view of the same numbers.
//
// Outstanding Receivable is a different kind of figure entirely -- not a
// cash movement, but a snapshot of unpaid customer invoices (Credit sales,
// or any invoice with a partial payment) as of today. It's money the
// business has already recognized as a sale but that hasn't reached the
// bank yet, which is exactly why this ledger's closing balance won't match
// total sales activity.
export default function CashCreditFlowTab() {
  const [from, setFrom] = useState(firstOfMonth())
  const [to, setTo] = useState(toISODate())
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
      supabase.from('sale_invoices').select('balance').gt('balance', 0),
    ])

    setOutstandingReceivable(round2((outstandingRows ?? []).reduce((s, r) => s + Number(r.balance), 0)))

    const dailyExpenseRows = (expenseRows ?? []).filter((e) => e.scope === 'daily')
    const monthlyExpenseRows = (expenseRows ?? []).filter((e) => e.scope !== 'daily')

    const byCategory = {
      Sales: sumByDate(salesRows ?? [], (r) => r.total),
      'Customer Payments': sumByDate(customerPaymentRows ?? [], (r) => r.amount),
      Purchases: sumByDate(purchaseRows ?? [], (r) => r.total),
      'Supplier Payments': sumByDate(supplierPaymentRows ?? [], (r) => r.amount),
      'Daily Expenses': sumByDate(dailyExpenseRows, (r) => r.amount),
      'Monthly Expenses': sumByDate(monthlyExpenseRows, (r) => r.amount),
      'Partner Payouts': sumByDate(partnerPayoutRows ?? [], (r) => r.amount),
    }
    const isOutflow = (category) => ['Purchases', 'Supplier Payments', 'Daily Expenses', 'Monthly Expenses', 'Partner Payouts'].includes(category)

    const entries = []
    CATEGORY_ORDER.forEach((category) => {
      Object.entries(byCategory[category]).forEach(([date, amount]) => {
        if (!amount) return
        entries.push({
          date,
          type: category,
          particulars: `${category} — ${formatDate(date)} (consolidated)`,
          debit: isOutflow(category) ? 0 : amount,
          credit: isOutflow(category) ? amount : 0,
        })
      })
    })

    const sorted = entries
      .filter((e) => e.date >= OPENING_BALANCE_DATE)
      .sort((a, b) => a.date.localeCompare(b.date) || CATEGORY_ORDER.indexOf(a.type) - CATEGORY_ORDER.indexOf(b.type))

    let running = OPENING_BALANCE_AMOUNT
    const withBalance = sorted.map((e) => {
      running = round2(running + (e.debit || 0) - (e.credit || 0))
      return { ...e, balance: running }
    })

    setAllEntries(withBalance)
    setLoading(false)
  }

  const { openingBalance, rows, closingBalance, totalReceipts, totalPayments } = useMemo(() => {
    const before = allEntries.filter((e) => e.date < from)
    const inRange = allEntries.filter((e) => e.date >= from && e.date <= to)
    const opening = before.length ? before[before.length - 1].balance : OPENING_BALANCE_AMOUNT
    const closing = inRange.length ? inRange[inRange.length - 1].balance : opening
    const receipts = round2(inRange.reduce((sum, e) => sum + (e.debit || 0), 0))
    const payments = round2(inRange.reduce((sum, e) => sum + (e.credit || 0), 0))
    return { openingBalance: opening, rows: inRange, closingBalance: closing, totalReceipts: receipts, totalPayments: payments }
  }, [allEntries, from, to])

  const exportRows = [
    { date: formatDate(from), type: '', particulars: 'Opening Balance', debit: null, credit: null, balance: openingBalance },
    ...rows.map((r) => ({
      date: formatDate(r.date),
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
          day instead of one line per transaction — Sales (Cash &amp; Bank), Customer Payments received,
          Purchases, Supplier Payments, Daily Expenses, Monthly Expenses, and Partner Payouts. Capital is
          excluded for the same reason as Bank Balance Ledger, and the ledger starts from the same confirmed
          opening balance of {formatMoney(OPENING_BALANCE_AMOUNT)} as of {formatDate(OPENING_BALANCE_DATE)}.
        </p>
        <div className="form-grid">
          <label>
            From
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            To
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
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
                Outstanding Receivable (as of today)
              </div>
              <strong style={{ fontSize: '1.1rem', color: outstandingReceivable > 0 ? 'var(--warning)' : undefined }}>
                {formatMoney(outstandingReceivable)}
              </strong>
              <div className="muted" style={{ fontSize: '0.75rem', maxWidth: 220 }}>
                Uncollected Credit sales — not yet at the bank, still pending to receive.
              </div>
            </div>
          </div>

          <div className="toolbar">
            <ExportButtons
              title="Cash Credit Flow"
              filename="cash_credit_flow"
              columns={[
                { key: 'date', label: 'Date' },
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
                  <th>Date</th>
                  <th>Category</th>
                  <th>Particulars</th>
                  <th>Receipts (Dr)</th>
                  <th>Payments (Cr)</th>
                  <th>Balance</th>
                </tr>
              </thead>
              <tbody>
                <tr style={{ fontWeight: 700 }}>
                  <td>{formatDate(from)}</td>
                  <td></td>
                  <td>Opening Balance</td>
                  <td>—</td>
                  <td>—</td>
                  <td>{formatMoney(openingBalance)}</td>
                </tr>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td>{formatDate(r.date)}</td>
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
