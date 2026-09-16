import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { formatDate, formatMoney, toISODate } from '../../lib/format'
import { round2 } from '../../lib/gst'
import { fetchAllRows } from '../../lib/fetchAllRows'
import ExportButtons from '../../components/ExportButtons'
import ReportPrintHeader from '../../components/ReportPrintHeader'

function firstOfMonth() {
  const d = new Date()
  return toISODate(new Date(d.getFullYear(), d.getMonth(), 1))
}

// Data before August 2026 (including July, when the system was still being
// set up) isn't reliable, so it's left out entirely. Instead the ledger
// starts from a known, manually confirmed figure: $10,000 cash+bank on hand
// as of 1 Aug 2026. That figure already accounts for everything before it,
// so pre-Aug-2026 transactions are excluded rather than replayed.
const OPENING_BALANCE_DATE = '2026-08-01'
const OPENING_BALANCE_AMOUNT = 10000

// Combined cash + bank position of the business -- every dollar actually
// received or paid out, regardless of whether it moved through the till or
// the bank account. Moving money between the two (a bank deposit of cash, a
// petty-cash top-up) is an internal transfer that nets to zero here, so
// those aren't listed as separate entries -- only money crossing the
// boundary of the business (from a customer, to a supplier/expense) counts.
//
// Capital contributions/withdrawals are deliberately excluded: the Capital
// module has no way to tell a real cash/bank movement apart from a non-cash
// entry (equipment, opening stock value, etc. logged as capital), so
// including it here risks overstating the balance. See Reports -> Capital
// for that separate ledger.
//
// The running balance starts at OPENING_BALANCE_AMOUNT on OPENING_BALANCE_DATE
// (see above) rather than replaying all history, then the [from, to] window
// is sliced out for display -- the "Opening Balance" shown is simply the
// running balance immediately before `from`.
export default function BankBalanceLedgerTab() {
  const [from, setFrom] = useState(firstOfMonth())
  const [to, setTo] = useState(toISODate())
  const [allEntries, setAllEntries] = useState([]) // full history, sorted, each carrying its running balance
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    setError('')
    try {
    const [salesRows, customerPaymentRows, purchaseRows, supplierPaymentRows, expenseRows, partnerPayoutRows] = await Promise.all([
      fetchAllRows(
        supabase
          .from('sale_invoices')
          .select('date, invoice_number, total, channel, customers(name)')
          .in('payment_type', ['Cash', 'Bank'])
      ),
      fetchAllRows(
        supabase.from('customer_payments').select('date, amount, payment_type, note, customers(name), sale_invoices(invoice_number)')
      ),
      fetchAllRows(
        supabase
          .from('purchase_invoices')
          .select('date, invoice_number, total, suppliers(name)')
          .in('payment_type', ['Cash', 'Bank'])
      ),
      fetchAllRows(
        supabase.from('supplier_payments').select('date, amount, payment_type, note, suppliers(name), purchase_invoices(invoice_number)')
      ),
      fetchAllRows(supabase.from('expenses').select('date, description, amount, expense_categories(name)').eq('entry_type', 'expense')),
      fetchAllRows(supabase.from('partner_payouts').select('date, amount, payment_type, note, partners(name)')),
    ])

    const entries = [
      ...(salesRows ?? []).map((s) => ({
        date: s.date,
        type: 'Sale',
        reference: s.invoice_number,
        particulars: `${s.channel} sale — ${s.customers?.name ?? 'Counter Sale'}`,
        debit: s.total,
        credit: 0,
      })),
      ...(customerPaymentRows ?? []).map((p) => ({
        date: p.date,
        type: 'Customer Payment',
        reference: p.sale_invoices?.invoice_number ?? '—',
        particulars: p.note || `${p.payment_type} received — ${p.customers?.name ?? '—'}`,
        debit: p.amount,
        credit: 0,
      })),
      ...(purchaseRows ?? []).map((p) => ({
        date: p.date,
        type: 'Purchase',
        reference: p.invoice_number,
        particulars: `Purchase — ${p.suppliers?.name ?? '—'}`,
        debit: 0,
        credit: p.total,
      })),
      ...(supplierPaymentRows ?? []).map((p) => ({
        date: p.date,
        type: 'Supplier Payment',
        reference: p.purchase_invoices?.invoice_number ?? '—',
        particulars: p.note || `${p.payment_type} paid — ${p.suppliers?.name ?? '—'}`,
        debit: 0,
        credit: p.amount,
      })),
      ...(expenseRows ?? []).map((e) => ({
        date: e.date,
        type: 'Expense',
        reference: e.expense_categories?.name ?? 'Uncategorized',
        particulars: e.description || e.expense_categories?.name || 'Expense',
        debit: 0,
        credit: e.amount,
      })),
      ...(partnerPayoutRows ?? []).map((p) => ({
        date: p.date,
        type: 'Partner Payout',
        reference: p.payment_type,
        particulars: p.note || `Payout to ${p.partners?.name ?? '—'}`,
        debit: 0,
        credit: p.amount,
      })),
    ]
      .filter((e) => e.date >= OPENING_BALANCE_DATE)
      .sort((a, b) => a.date.localeCompare(b.date) || a.type.localeCompare(b.type))

    let running = OPENING_BALANCE_AMOUNT
    const withBalance = entries.map((e) => {
      running = round2(running + (e.debit || 0) - (e.credit || 0))
      return { ...e, balance: running }
    })

    setAllEntries(withBalance)
    } catch (e) {
      setError(e.message || 'Failed to load report data.')
    }
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
    { date: formatDate(from), type: '', reference: '', particulars: 'Opening Balance', debit: null, credit: null, balance: openingBalance },
    ...rows.map((r) => ({
      date: formatDate(r.date),
      type: r.type,
      reference: r.reference,
      particulars: r.particulars,
      debit: r.debit || null,
      credit: r.credit || null,
      balance: r.balance,
    })),
  ]

  return (
    <div>
      <ReportPrintHeader title="Bank Balance Ledger" />
      <div className="card">
        <p className="muted" style={{ fontSize: '0.85rem', marginTop: 0 }}>
          Combined cash + bank position of the business — cash &amp; bank sales, customer payments received,
          purchases &amp; supplier payments, expenses, and partner payouts (Cash and Bank alike). Transfers
          between till and bank (deposits, petty-cash top-ups) are internal and net to zero, so they aren't
          listed separately. Capital contributions/withdrawals are not included (see Reports → Capital). The ledger starts from a
          confirmed opening balance of {formatMoney(OPENING_BALANCE_AMOUNT)} as of {formatDate(OPENING_BALANCE_DATE)};
          data before that date isn't reliable and is left out entirely.
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

      {error && <div className="inline-error">{error}</div>}
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
          </div>

          <div className="toolbar">
            <ExportButtons
              title="Bank Balance Ledger"
              filename="bank_balance_ledger"
              columns={[
                { key: 'date', label: 'Date' },
                { key: 'type', label: 'Type' },
                { key: 'reference', label: 'Reference' },
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
                  <th>Type</th>
                  <th>Reference</th>
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
                    <td>{r.reference}</td>
                    <td>{r.particulars}</td>
                    <td>{r.debit ? formatMoney(r.debit) : '—'}</td>
                    <td>{r.credit ? formatMoney(r.credit) : '—'}</td>
                    <td>{formatMoney(r.balance)}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="muted">
                      No activity in this range.
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr style={{ fontWeight: 700 }}>
                  <td colSpan={4}>Closing Balance</td>
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
