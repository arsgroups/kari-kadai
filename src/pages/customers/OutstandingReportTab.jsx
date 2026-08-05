import { useEffect, useState } from 'react'
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
            { key: 'outstanding', label: 'Outstanding' },
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
                <th>Customer</th>
                <th>Type</th>
                <th>Outstanding</th>
                <th>Oldest Unpaid Since</th>
                <th>Age</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.customer_id}>
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
              ))}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
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
