import { Fragment, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { formatDate, formatMoney, toISODate } from '../../lib/format'
import ExportButtons from '../../components/ExportButtons'

const SORT_OPTIONS = [
  { value: 'amount', label: 'Amount (highest first)' },
  { value: 'age', label: 'Age of debt (oldest first)' },
]

// For each customer, walks their unpaid invoices oldest-first and consumes
// payments against them FIFO-style, to find the date of the oldest still-unpaid one.
function computeOldestUnpaidDate(invoicesWithBalance, totalPayments) {
  let remainingPayments = totalPayments
  for (const invoice of invoicesWithBalance) {
    if (remainingPayments >= invoice.balance) {
      remainingPayments -= invoice.balance
    } else {
      return invoice.date
    }
  }
  return null // fully paid off
}

export default function OutstandingReportTab() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [sortBy, setSortBy] = useState('amount')
  const [expandedId, setExpandedId] = useState(null)
  const [invoicesByCustomer, setInvoicesByCustomer] = useState({})

  async function load() {
    setLoading(true)
    setError('')
    const { data: outstandingRows, error: outErr } = await supabase
      .from('v_customer_outstanding')
      .select('*')
      .gt('outstanding', 0)

    if (outErr) {
      setError(outErr.message)
      setLoading(false)
      return
    }

    const enriched = await Promise.all(
      (outstandingRows ?? []).map(async (row) => {
        const [{ data: invoices }, { data: payments }] = await Promise.all([
          supabase
            .from('sale_invoices')
            .select('date, balance')
            .eq('customer_id', row.customer_id)
            .gt('balance', 0)
            .order('date', { ascending: true }),
          supabase.from('customer_payments').select('amount').eq('customer_id', row.customer_id),
        ])
        const totalPayments = (payments ?? []).reduce((sum, p) => sum + p.amount, 0)
        const oldestUnpaidDate = computeOldestUnpaidDate(invoices ?? [], totalPayments)
        const ageDays = oldestUnpaidDate
          ? Math.floor((new Date(toISODate()) - new Date(oldestUnpaidDate)) / (1000 * 60 * 60 * 24))
          : 0
        return { ...row, oldestUnpaidDate, ageDays }
      })
    )

    setRows(enriched)
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  async function toggleExpand(customerId) {
    if (expandedId === customerId) {
      setExpandedId(null)
      return
    }
    setExpandedId(customerId)
    if (!invoicesByCustomer[customerId]) {
      const { data } = await supabase
        .from('sale_invoices')
        .select('id, invoice_number, date, channel, total, paid_amount, balance')
        .eq('customer_id', customerId)
        .eq('payment_type', 'Credit')
        .order('date', { ascending: false })
      setInvoicesByCustomer((prev) => ({ ...prev, [customerId]: data ?? [] }))
    }
  }

  const sorted = [...rows].sort((a, b) =>
    sortBy === 'amount' ? b.outstanding - a.outstanding : b.ageDays - a.ageDays
  )

  const exportRows = sorted.map((r) => ({
    name: r.name,
    type: r.type,
    outstanding: formatMoney(r.outstanding),
    oldest_unpaid_since: r.oldestUnpaidDate ? formatDate(r.oldestUnpaidDate) : '-',
    age_days: r.ageDays,
  }))

  return (
    <div>
      <div className="toolbar">
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          Sort by
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <ExportButtons
          title="Outstanding Customers"
          filename="outstanding_customers"
          columns={[
            { key: 'name', label: 'Customer' },
            { key: 'type', label: 'Type' },
            { key: 'outstanding', label: 'Outstanding', money: true },
            { key: 'oldest_unpaid_since', label: 'Oldest Unpaid Since' },
            { key: 'age_days', label: 'Age (days)' },
          ]}
          rows={exportRows}
        />
      </div>

      <div className="card">
        {error && <div className="inline-error">{error}</div>}
        {loading ? (
          <p className="muted">Loading…</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th></th>
                <th>Customer</th>
                <th>Type</th>
                <th>Outstanding</th>
                <th>Oldest Unpaid Since</th>
                <th>Age</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const invoices = invoicesByCustomer[r.customer_id] ?? []
                const invoiceExportRows = invoices.map((inv) => ({
                  customer: r.name,
                  invoice_number: inv.invoice_number,
                  date: formatDate(inv.date),
                  channel: inv.channel,
                  total: inv.total,
                  paid: inv.paid_amount,
                  balance: inv.balance,
                }))
                return (
                <Fragment key={r.customer_id}>
                  <tr>
                    <td>
                      <button className="btn-secondary" onClick={() => toggleExpand(r.customer_id)}>
                        {expandedId === r.customer_id ? '−' : '+'}
                      </button>
                    </td>
                    <td>{r.name}</td>
                    <td>{r.type}</td>
                    <td>{formatMoney(r.outstanding)}</td>
                    <td>{r.oldestUnpaidDate ? formatDate(r.oldestUnpaidDate) : '—'}</td>
                    <td>
                      <span className={r.ageDays > 30 ? 'tag tag-danger' : r.ageDays > 14 ? 'tag tag-warning' : 'tag tag-muted'}>
                        {r.ageDays} days
                      </span>
                    </td>
                  </tr>
                  {expandedId === r.customer_id && (
                    <tr>
                      <td></td>
                      <td colSpan={5}>
                        <div className="toolbar" style={{ marginBottom: '0.5rem' }}>
                          <ExportButtons
                            title={`Credit Invoices — ${r.name}`}
                            filename={`credit_invoices_${r.name.replace(/\s+/g, '_')}`}
                            columns={[
                              { key: 'customer', label: 'Customer' },
                              { key: 'invoice_number', label: 'Invoice #' },
                              { key: 'date', label: 'Date' },
                              { key: 'channel', label: 'Channel' },
                              { key: 'total', label: 'Total', money: true },
                              { key: 'paid', label: 'Paid', money: true },
                              { key: 'balance', label: 'Balance', money: true },
                            ]}
                            rows={invoiceExportRows}
                          />
                        </div>
                        <table className="data-table">
                          <thead>
                            <tr>
                              <th>Customer</th>
                              <th>Invoice #</th>
                              <th>Date</th>
                              <th>Channel</th>
                              <th>Total</th>
                              <th>Paid</th>
                              <th>Balance</th>
                            </tr>
                          </thead>
                          <tbody>
                            {invoices.map((inv) => (
                              <tr key={inv.id}>
                                <td>{r.name}</td>
                                <td>{inv.invoice_number}</td>
                                <td>{formatDate(inv.date)}</td>
                                <td>{inv.channel}</td>
                                <td>{formatMoney(inv.total)}</td>
                                <td>{formatMoney(inv.paid_amount)}</td>
                                <td>{formatMoney(inv.balance)}</td>
                              </tr>
                            ))}
                            {invoices.length === 0 && (
                              <tr>
                                <td colSpan={7} className="muted">
                                  No credit invoices for this customer.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
                )
              })}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    No outstanding balances — everyone's settled up.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
