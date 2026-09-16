import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { formatMoney } from '../../lib/format'
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

// Display order for the waterfall statement AND the monthly detail table --
// money in, then money out. Customer Payments (old credit collected) and
// Supplier Payments (credit purchases settled) aren't things the user asked
// for by name, but leaving them out would make "how much should be in bank"
// wrong the moment any credit sale is collected or credit purchase is paid
// off -- so they're kept as their own clearly-labeled lines rather than
// silently folded into Sales/Purchases or dropped.
const CATEGORY_ORDER = ['Sales', 'Customer Payments', 'Purchases', 'Supplier Payments', 'Daily Expenses', 'Monthly Expenses', 'Partner Payouts']
const OUTFLOW_CATEGORIES = ['Purchases', 'Supplier Payments', 'Daily Expenses', 'Monthly Expenses', 'Partner Payouts']
const CATEGORY_LABELS = {
  Sales: 'Actual Sales (Cash & Bank)',
  'Customer Payments': 'Customer Payments Received (old credit collected)',
  Purchases: 'Actual Purchases (Cash & Bank)',
  'Supplier Payments': 'Supplier Payments (credit purchases settled)',
  'Daily Expenses': 'Daily Expenses',
  'Monthly Expenses': 'Monthly Expenses',
  'Partner Payouts': 'Partner Payouts',
}

function sumByMonth(rows, amountFn) {
  const totals = {}
  rows.forEach((r) => {
    const key = r.date.slice(0, 7)
    totals[key] = round2((totals[key] ?? 0) + amountFn(r))
  })
  return totals
}

// A plain-language answer to "how much should be in the bank?" for
// shareholders, not a transaction-level ledger: Opening Balance, one clearly
// labeled line per category (money in, then money out), and the resulting
// Expected Bank Balance. Same combined cash+bank scope as Bank Balance
// Ledger (Capital excluded for the same reason -- no reliable cash-vs-
// non-cash split there there), so the two reports' balance for the same
// cut-off always agrees. A monthly detail table underneath lets anyone
// trace the statement's numbers back to individual months if needed.
//
// Outstanding is a different kind of figure entirely -- not a cash
// movement, but a snapshot of what customers still owe right now, shown
// separately and explicitly NOT part of the Expected Bank Balance math
// (that money hasn't reached the bank). It reuses v_customer_outstanding,
// the same view Customers -> Outstanding is built on: per customer, sum of
// invoice balances minus all payments ever received from them. A raw sum of
// sale_invoices.balance alone would be wrong -- that column only reflects
// what was paid AT the time the invoice was raised and is never updated
// when a later customer_payments row settles it, so an invoice paid off in
// full afterwards would still show as outstanding.
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

  const { openingBalance, rows, closingBalance, categoryTotals } = useMemo(() => {
    const before = allEntries.filter((e) => e.month < fromMonth)
    const inRange = allEntries.filter((e) => e.month >= fromMonth && e.month <= toMonth)
    const opening = before.length ? before[before.length - 1].balance : OPENING_BALANCE_AMOUNT
    const closing = inRange.length ? inRange[inRange.length - 1].balance : opening
    const totals = {}
    CATEGORY_ORDER.forEach((category) => {
      totals[category] = round2(
        inRange.filter((e) => e.type === category).reduce((sum, e) => sum + (e.debit || 0) + (e.credit || 0), 0)
      )
    })
    return { openingBalance: opening, rows: inRange, closingBalance: closing, categoryTotals: totals }
  }, [allEntries, fromMonth, toMonth])

  const exportRows = [
    { line: 'Opening Balance', amount: openingBalance },
    ...CATEGORY_ORDER.map((category) => ({
      line: CATEGORY_LABELS[category],
      amount: OUTFLOW_CATEGORIES.includes(category) ? -categoryTotals[category] : categoryTotals[category],
    })),
    { line: 'Expected Bank Balance', amount: closingBalance },
    { line: 'Outstanding (not yet at the bank)', amount: outstandingReceivable },
  ]

  const monthlyExportRows = rows.map((r) => ({
    month: monthLabel(r.month),
    category: CATEGORY_LABELS[r.type],
    debit: r.debit || null,
    credit: r.credit || null,
    balance: r.balance,
  }))

  return (
    <div>
      <ReportPrintHeader title="Cash Credit Flow" />
      <div className="card">
        <p className="muted" style={{ fontSize: '0.85rem', marginTop: 0 }}>
          A plain-language answer to "how much should be in the bank?" — Opening Balance, actual money in
          (Sales, Customer Payments) and out (Purchases, Supplier Payments, Expenses, Partner Payouts) for the
          selected months, and the resulting Expected Bank Balance. Same combined cash + bank scope as Bank
          Balance Ledger (Capital excluded for the same reason), starting from the same confirmed opening
          balance of {formatMoney(OPENING_BALANCE_AMOUNT)} as of {monthLabel(OPENING_MONTH)}.
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
          <div className="card">
            <div className="toolbar" style={{ justifyContent: 'space-between' }}>
              <h3 style={{ margin: 0 }}>
                Statement: {monthLabel(fromMonth)} – {monthLabel(toMonth)}
              </h3>
              <ExportButtons
                title="Cash Credit Flow — Statement"
                filename="cash_credit_flow_statement"
                columns={[
                  { key: 'line', label: 'Line' },
                  { key: 'amount', label: 'Amount', money: true },
                ]}
                rows={exportRows}
              />
            </div>
            <table className="data-table" style={{ maxWidth: 560 }}>
              <tbody>
                <tr>
                  <td>Opening Balance ({monthLabel(fromMonth)})</td>
                  <td>{formatMoney(openingBalance)}</td>
                </tr>
                {CATEGORY_ORDER.map((category) => {
                  const isOutflow = OUTFLOW_CATEGORIES.includes(category)
                  const amount = categoryTotals[category]
                  return (
                    <tr key={category}>
                      <td>
                        {isOutflow ? '−' : '+'} {CATEGORY_LABELS[category]}
                      </td>
                      <td>{formatMoney(amount)}</td>
                    </tr>
                  )
                })}
                <tr style={{ fontWeight: 700, fontSize: '1.05rem' }}>
                  <td>= Expected Bank Balance ({monthLabel(toMonth)})</td>
                  <td>{formatMoney(closingBalance)}</td>
                </tr>
                <tr>
                  <td colSpan={2}>&nbsp;</td>
                </tr>
                <tr>
                  <td>
                    Outstanding — owed by customers, not yet received
                    <div className="muted" style={{ fontSize: '0.75rem' }}>
                      Informational only — this money is still outside, not part of the balance above.
                    </div>
                  </td>
                  <td style={{ color: outstandingReceivable > 0 ? 'var(--warning)' : undefined, fontWeight: 700 }}>
                    {formatMoney(outstandingReceivable)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="card">
            <div className="toolbar" style={{ justifyContent: 'space-between' }}>
              <h3 style={{ margin: 0 }}>Monthly Detail</h3>
              <ExportButtons
                title="Cash Credit Flow — Monthly Detail"
                filename="cash_credit_flow_monthly"
                columns={[
                  { key: 'month', label: 'Month' },
                  { key: 'category', label: 'Category' },
                  { key: 'debit', label: 'Money In', money: true },
                  { key: 'credit', label: 'Money Out', money: true },
                  { key: 'balance', label: 'Balance', money: true },
                ]}
                rows={monthlyExportRows}
              />
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Category</th>
                  <th>Money In</th>
                  <th>Money Out</th>
                  <th>Balance</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td>{monthLabel(r.month)}</td>
                    <td>
                      <span className={r.debit ? 'tag tag-success' : 'tag tag-warning'}>{CATEGORY_LABELS[r.type]}</span>
                    </td>
                    <td>{r.debit ? formatMoney(r.debit) : '—'}</td>
                    <td>{r.credit ? formatMoney(r.credit) : '—'}</td>
                    <td>{formatMoney(r.balance)}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="muted">
                      No activity in this range.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
