import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { formatDate, formatMoney, toISODate } from '../../lib/format'
import ExportButtons from '../../components/ExportButtons'

function firstOfMonth() {
  const d = new Date()
  return toISODate(new Date(d.getFullYear(), d.getMonth(), 1))
}

export default function CustomerLedgerTab() {
  const [customers, setCustomers] = useState([])
  const [customerId, setCustomerId] = useState('')
  const [from, setFrom] = useState(firstOfMonth())
  const [to, setTo] = useState(toISODate())
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    supabase.from('customers').select('id, name').order('name').then(({ data }) => setCustomers(data ?? []))
  }, [])

  useEffect(() => {
    if (customerId) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId, from, to])

  async function load() {
    setLoading(true)
    const [{ data: invoices }, { data: payments }] = await Promise.all([
      supabase
        .from('sale_invoices')
        .select('date, invoice_number, total, payment_type')
        .eq('customer_id', customerId)
        .gte('date', from)
        .lte('date', to),
      supabase
        .from('customer_payments')
        .select('date, amount, payment_type, note')
        .eq('customer_id', customerId)
        .gte('date', from)
        .lte('date', to),
    ])

    const entries = [
      ...(invoices ?? []).map((i) => ({
        date: i.date,
        type: 'Invoice',
        reference: i.invoice_number,
        debit: i.total,
        credit: 0,
        note: i.payment_type,
      })),
      ...(payments ?? []).map((p) => ({
        date: p.date,
        type: 'Payment',
        reference: p.payment_type,
        debit: 0,
        credit: p.amount,
        note: p.note,
      })),
    ].sort((a, b) => a.date.localeCompare(b.date))

    let running = 0
    const withBalance = entries.map((e) => {
      running += e.debit - e.credit
      return { ...e, balance: running }
    })

    setRows(withBalance)
    setLoading(false)
  }

  const exportRows = rows.map((r) => ({
    date: formatDate(r.date),
    type: r.type,
    reference: r.reference,
    debit: r.debit,
    credit: r.credit,
    balance: r.balance,
  }))

  return (
    <div>
      <div className="card">
        <div className="form-grid">
          <label>
            Customer
            <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">Select a customer…</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
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

      {customerId && (
        <>
          <div className="toolbar">
            <ExportButtons
              title="Customer Ledger"
              filename="customer_ledger"
              columns={[
                { key: 'date', label: 'Date' },
                { key: 'type', label: 'Type' },
                { key: 'reference', label: 'Reference' },
                { key: 'debit', label: 'Debit (Invoiced)' },
                { key: 'credit', label: 'Credit (Paid)' },
                { key: 'balance', label: 'Running Balance' },
              ]}
              rows={exportRows}
            />
          </div>
          <div className="card">
            {loading ? (
              <p className="muted">Loading…</p>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Reference</th>
                    <th>Debit (Invoiced)</th>
                    <th>Credit (Paid)</th>
                    <th>Running Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i}>
                      <td>{formatDate(r.date)}</td>
                      <td>
                        <span className={r.type === 'Invoice' ? 'tag tag-warning' : 'tag tag-success'}>{r.type}</span>
                      </td>
                      <td>{r.reference}</td>
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
              </table>
            )}
          </div>
        </>
      )}
    </div>
  )
}
