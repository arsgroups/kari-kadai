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

// Combined cash + bank position of the business -- every dollar actually
// received or paid out, regardless of whether it moved through the till or
// the bank account. Moving money between the two (a bank deposit of cash, a
// petty-cash top-up) is an internal transfer that nets to zero here, so
// those aren't listed as separate entries -- only money crossing the
// boundary of the business (in from a customer/partner, out to a
// supplier/expense/partner) counts.
//
// There is no stored "opening balance" anywhere in the system, so this
// report computes one by replaying every transaction from the very first
// record. That means it always fetches full history, then slices the
// [from, to] window for display -- the "Opening Balance" shown is simply the
// running balance immediately before `from`.
export default function BankBalanceLedgerTab() {
  const [from, setFrom] = useState(firstOfMonth())
  const [to, setTo] = useState(toISODate())
  const [allEntries, setAllEntries] = useState([]) // full history, sorted, each carrying its running balance
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    const [
      { data: capitalRows },
      { data: salesRows },
      { data: customerPaymentRows },
      { data: purchaseRows },
      { data: supplierPaymentRows },
      { data: expenseRows },
    ] = await Promise.all([
      supabase.from('capital_transactions').select('date, partner_name, transaction_type, amount, description'),
      supabase
        .from('sale_invoices')
        .select('date, invoice_number, total, channel, customers(name)')
        .in('payment_type', ['Cash', 'Bank']),
      supabase
        .from('customer_payments')
        .select('date, amount, payment_type, note, customers(name), sale_invoices(invoice_number)'),
      supabase
        .from('purchase_invoices')
        .select('date, invoice_number, total, suppliers(name)')
        .in('payment_type', ['Cash', 'Bank']),
      supabase
        .from('supplier_payments')
        .select('date, amount, payment_type, note, suppliers(name), purchase_invoices(invoice_number)'),
      supabase
        .from('expenses')
        .select('date, description, amount, expense_categories(name)')
        .eq('entry_type', 'expense'),
    ])

    const entries = [
      ...(capitalRows ?? []).map((c) => ({
        date: c.date,
        type: 'Capital',
        reference: c.partner_name,
        particulars: c.description || (c.transaction_type === 'contribution' ? 'Capital contribution' : 'Capital withdrawal'),
        debit: c.transaction_type === 'contribution' ? c.amount : 0,
        credit: c.transaction_type === 'withdrawal' ? c.amount : 0,
      })),
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
    ].sort((a, b) => a.date.localeCompare(b.date) || a.type.localeCompare(b.type))

    let running = 0
    const withBalance = entries.map((e) => {
      running = round2(running + (e.debit || 0) - (e.credit || 0))
      return { ...e, balance: running }
    })

    setAllEntries(withBalance)
    setLoading(false)
  }

  const { openingBalance, rows, closingBalance, totalReceipts, totalPayments } = useMemo(() => {
    const before = allEntries.filter((e) => e.date < from)
    const inRange = allEntries.filter((e) => e.date >= from && e.date <= to)
    const opening = before.length ? before[before.length - 1].balance : 0
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
          Combined cash + bank position of the business — capital in/out, cash &amp; bank sales, customer
          payments received, purchases &amp; supplier payments, and expenses (Cash and Bank alike). Transfers
          between till and bank (deposits, petty-cash top-ups) are internal and net to zero, so they aren't
          listed separately. Running balance is computed from the very first recorded transaction.
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
