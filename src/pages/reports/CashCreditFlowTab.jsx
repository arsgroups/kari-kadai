import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { formatMoney, toISODate } from '../../lib/format'
import { round2 } from '../../lib/gst'
import { fetchAllRows } from '../../lib/fetchAllRows'
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

function monthStart(monthKey) {
  return `${monthKey}-01`
}

// Last calendar day of a 'YYYY-MM' month -- day 0 of the next month.
function monthEnd(monthKey) {
  const [y, m] = monthKey.split('-').map(Number)
  return toISODate(new Date(y, m, 0))
}

// Accounting-statement convention: a deduction is shown in parentheses
// rather than with a leading minus sign.
function formatBracket(amount, isOutflow) {
  return isOutflow ? `(${formatMoney(amount)})` : formatMoney(amount)
}

// Same anchor as Reports -> Bank Balance Ledger -- both reports track the
// same underlying combined cash+bank position, just at different levels of
// detail, so they must start from the same confirmed figure to ever
// reconcile with each other.
const OPENING_MONTH = '2026-08'
const OPENING_BALANCE_AMOUNT = 10000

// Categories used to carry the running balance forward from OPENING_MONTH to
// the start of the selected period, and to drive the Monthly Detail table.
// "Sales" here is Cash+Bank invoices only (money that landed immediately);
// "Customer Payments"/"Supplier Payments" cover credit settled later -- see
// the Statement section below for a different, period-scoped breakdown of
// the same Sales number that separates out what's still outstanding.
const CATEGORY_ORDER = ['Sales', 'Customer Payments', 'Purchases', 'Supplier Payments', 'Daily Expenses', 'Monthly Expenses', 'Partner Payouts']
const OUTFLOW_CATEGORIES = ['Purchases', 'Supplier Payments', 'Daily Expenses', 'Monthly Expenses', 'Partner Payouts']
const CATEGORY_LABELS = {
  Sales: 'Sales (Cash & Bank)',
  'Customer Payments': 'Customer Payments Received (old credit collected)',
  Purchases: 'Purchases (Cash & Bank)',
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
// shareholders. The Statement at the top is a straightforward waterfall for
// the selected period: Opening Balance, Actual Sales (every invoice raised,
// Cash+Bank+Credit -- matches the Sales page's own "Total" tile), less
// Outstanding (of THOSE invoices, what's still unpaid as of the period's end
// -- matches the Sales page's own "Outstanding" tile, invoice-by-invoice,
// not a company-wide snapshot), plus old credit collected this period, less
// Purchases/Supplier Payments/Expenses/Partner Payouts, down to Expected
// Bank Balance. A Monthly Detail table underneath (Cash+Bank sales lens,
// same categories as Bank Balance Ledger) lets anyone trace it back month by
// month; the two views are mathematically equivalent, just decomposed
// differently -- see the code comments in load()/statement below for why.
//
// IMPORTANT: every query here fetches full (or period-wide) history via
// fetchAllRows rather than a plain .select() -- Supabase caps a plain
// select at 1000 rows, and this business already has more sale_invoices
// than that, so a naive fetch was silently dropping rows and understating
// every total. This was the cause of "Actual Sales" looking far too low.
export default function CashCreditFlowTab() {
  const [fromMonth, setFromMonth] = useState(OPENING_MONTH)
  const [toMonth, setToMonth] = useState(currentMonthKey())
  const [allEntries, setAllEntries] = useState([])
  const [statement, setStatement] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    loadHistory()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    loadStatement()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromMonth, toMonth])

  // Full-history monthly totals -- drives the running balance (Opening
  // Balance carried into fromMonth, Expected Bank Balance at the end of
  // toMonth) and the Monthly Detail table.
  async function loadHistory() {
    setLoading(true)
    setError('')
    try {
      const [salesRows, customerPaymentRows, purchaseRows, supplierPaymentRows, expenseRows, partnerPayoutRows] = await Promise.all([
        fetchAllRows(supabase.from('sale_invoices').select('date, total').in('payment_type', ['Cash', 'Bank'])),
        fetchAllRows(supabase.from('customer_payments').select('date, amount')),
        fetchAllRows(supabase.from('purchase_invoices').select('date, total').in('payment_type', ['Cash', 'Bank'])),
        fetchAllRows(supabase.from('supplier_payments').select('date, amount')),
        fetchAllRows(supabase.from('expenses').select('date, scope, amount').eq('entry_type', 'expense')),
        fetchAllRows(supabase.from('partner_payouts').select('date, amount')),
      ])

      const dailyExpenseRows = expenseRows.filter((e) => e.scope === 'daily')
      const monthlyExpenseRows = expenseRows.filter((e) => e.scope !== 'daily')

      const byCategory = {
        Sales: sumByMonth(salesRows, (r) => r.total),
        'Customer Payments': sumByMonth(customerPaymentRows, (r) => r.amount),
        Purchases: sumByMonth(purchaseRows, (r) => r.total),
        'Supplier Payments': sumByMonth(supplierPaymentRows, (r) => r.amount),
        'Daily Expenses': sumByMonth(dailyExpenseRows, (r) => r.amount),
        'Monthly Expenses': sumByMonth(monthlyExpenseRows, (r) => r.amount),
        'Partner Payouts': sumByMonth(partnerPayoutRows, (r) => r.amount),
      }

      const entries = []
      CATEGORY_ORDER.forEach((category) => {
        Object.entries(byCategory[category]).forEach(([month, amount]) => {
          if (!amount) return
          const isOutflow = OUTFLOW_CATEGORIES.includes(category)
          entries.push({ month, type: category, debit: isOutflow ? 0 : amount, credit: isOutflow ? amount : 0 })
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
    } catch (e) {
      setError(e.message || 'Failed to load report data.')
    }
    setLoading(false)
  }

  // Period-scoped breakdown for the Statement: every invoice raised within
  // [fromMonth, toMonth], regardless of payment_type (matches the Sales
  // page's "Total"), split into what's actually been collected vs what's
  // still outstanding as of toMonth's last day -- each invoice's own
  // balance (set at creation) minus whatever customer_payments have been
  // recorded against it by that cut-off, floored at 0 -- the same
  // invoice-by-invoice logic the Sales page itself uses (never a
  // company-wide snapshot that could span unrelated periods).
  async function loadStatement() {
    try {
      const periodStart = monthStart(fromMonth)
      const periodEnd = monthEnd(toMonth)
      const [periodInvoices, periodPayments] = await Promise.all([
        fetchAllRows(supabase.from('sale_invoices').select('id, total, balance').gte('date', periodStart).lte('date', periodEnd)),
        fetchAllRows(
          supabase
            .from('customer_payments')
            .select('invoice_id, amount, sale_invoices(date)')
            .gte('date', periodStart)
            .lte('date', periodEnd)
        ),
      ])

      const periodInvoiceIds = new Set(periodInvoices.map((i) => i.id))
      const paidAgainstPeriodInvoice = {}
      let oldCreditCollected = 0
      periodPayments.forEach((p) => {
        if (p.invoice_id && periodInvoiceIds.has(p.invoice_id)) {
          paidAgainstPeriodInvoice[p.invoice_id] = round2((paidAgainstPeriodInvoice[p.invoice_id] ?? 0) + p.amount)
        } else {
          oldCreditCollected = round2(oldCreditCollected + p.amount)
        }
      })

      const actualSales = round2(periodInvoices.reduce((s, i) => s + Number(i.total), 0))
      const outstanding = round2(
        periodInvoices.reduce((s, i) => s + Math.max(Number(i.balance) - (paidAgainstPeriodInvoice[i.id] ?? 0), 0), 0)
      )

      setStatement({ actualSales, outstanding, oldCreditCollected })
    } catch (e) {
      setError(e.message || 'Failed to load statement data.')
    }
  }

  const { openingBalance, rows, closingBalance, categoryTotals } = useMemo(() => {
    const before = allEntries.filter((e) => e.month < fromMonth)
    const inRange = allEntries.filter((e) => e.month >= fromMonth && e.month <= toMonth)
    const opening = before.length ? before[before.length - 1].balance : OPENING_BALANCE_AMOUNT
    const closing = inRange.length ? inRange[inRange.length - 1].balance : opening
    const totals = {}
    CATEGORY_ORDER.forEach((category) => {
      totals[category] = round2(inRange.filter((e) => e.type === category).reduce((sum, e) => sum + (e.debit || 0) + (e.credit || 0), 0))
    })
    return { openingBalance: opening, rows: inRange, closingBalance: closing, categoryTotals: totals }
  }, [allEntries, fromMonth, toMonth])

  // Purchases/Supplier Payments/Expenses/Partner Payouts come straight from
  // the same monthly totals driving the running balance -- only Sales is
  // replaced with the period-scoped Actual Sales / Outstanding / Old Credit
  // Collected breakdown, which nets to the exact same figure (see loadStatement).
  const statementRows = statement
    ? [
        { label: 'Actual Sales (every invoice raised, Cash + Bank + Credit)', amount: statement.actualSales, isOutflow: false },
        { label: 'Outstanding (of those invoices, still unpaid)', amount: statement.outstanding, isOutflow: true },
        { label: CATEGORY_LABELS['Customer Payments'], amount: statement.oldCreditCollected, isOutflow: false },
        {
          label: 'Purchases & Payments to Supplier',
          amount: round2(categoryTotals['Purchases'] + categoryTotals['Supplier Payments']),
          isOutflow: true,
        },
        { label: CATEGORY_LABELS['Daily Expenses'], amount: categoryTotals['Daily Expenses'], isOutflow: true },
        { label: CATEGORY_LABELS['Monthly Expenses'], amount: categoryTotals['Monthly Expenses'], isOutflow: true },
        { label: CATEGORY_LABELS['Partner Payouts'], amount: categoryTotals['Partner Payouts'], isOutflow: true },
      ]
    : []

  const exportRows = [
    { line: `Opening Balance (${monthLabel(fromMonth)})`, amount: openingBalance },
    ...statementRows.map((r) => ({ line: r.label, amount: r.isOutflow ? -r.amount : r.amount })),
    { line: `Expected Bank Balance (${monthLabel(toMonth)})`, amount: closingBalance },
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
          A plain-language answer to "how much should be in the bank?" for the selected months — Opening
          Balance, Actual Sales less what's still Outstanding, plus old credit collected, less Purchases,
          Supplier Payments, Expenses, and Partner Payouts, down to Expected Bank Balance. Same combined cash +
          bank scope as Bank Balance Ledger (Capital excluded for the same reason), starting from the same
          confirmed opening balance of {formatMoney(OPENING_BALANCE_AMOUNT)} as of {monthLabel(OPENING_MONTH)}.
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

      {error && <div className="inline-error">{error}</div>}

      {loading || !statement ? (
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
                {statementRows.map((r) => (
                  <tr key={r.label}>
                    <td>{r.label}</td>
                    <td style={r.isOutflow ? { color: 'var(--warning)' } : undefined}>{formatBracket(r.amount, r.isOutflow)}</td>
                  </tr>
                ))}
                <tr style={{ fontWeight: 700, fontSize: '1.05rem' }}>
                  <td>= Expected Bank Balance ({monthLabel(toMonth)})</td>
                  <td>{formatMoney(closingBalance)}</td>
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
            <p className="muted" style={{ fontSize: '0.8rem', marginTop: '-0.5rem' }}>
              Cash-received lens (Cash &amp; Bank sales as they were raised, plus all customer payments received)
              rather than the Statement's Actual-Sales-less-Outstanding lens above — both reconcile to the same
              Expected Bank Balance, just broken down differently.
            </p>
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
