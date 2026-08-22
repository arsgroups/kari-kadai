import { Fragment, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { formatDate, formatMoney, toISODate } from '../../lib/format'
import ExportButtons from '../../components/ExportButtons'

function firstOfMonth() {
  const d = new Date()
  return toISODate(new Date(d.getFullYear(), d.getMonth(), 1))
}

export default function SalesReturnsListTab() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [from, setFrom] = useState(firstOfMonth())
  const [to, setTo] = useState(toISODate())
  const [expandedId, setExpandedId] = useState(null)
  const [itemsByReturn, setItemsByReturn] = useState({})

  async function load() {
    setLoading(true)
    setError('')
    const { data, error } = await supabase
      .from('sale_returns')
      .select('id, return_number, date, reason, subtotal, gst_amount, total, sale_invoices(invoice_number, channel, customers(name))')
      .gte('date', from)
      .lte('date', to)
      .order('date', { ascending: false })
      .limit(500)
    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }
    setRows(data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to])

  async function toggleExpand(returnId) {
    if (expandedId === returnId) {
      setExpandedId(null)
      return
    }
    setExpandedId(returnId)
    if (!itemsByReturn[returnId]) {
      const { data } = await supabase
        .from('sale_return_items')
        .select('id, quantity, unit, rate, amount, products(name)')
        .eq('sale_return_id', returnId)
      setItemsByReturn({ ...itemsByReturn, [returnId]: data ?? [] })
    }
  }

  const totalAmount = rows.reduce((sum, r) => sum + r.total, 0)

  const exportRows = rows.map((r) => ({
    return_number: r.return_number,
    date: formatDate(r.date),
    invoice_number: r.sale_invoices?.invoice_number ?? '',
    customer: r.sale_invoices?.customers?.name ?? '',
    channel: r.sale_invoices?.channel ?? '',
    reason: r.reason ?? '',
    total: r.total,
  }))

  return (
    <div>
      <div className="card">
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

      <div className="toolbar">
        <div className="tile" style={{ margin: 0 }}>
          <div className="tile-label">Total Returned (filtered)</div>
          <div className="tile-value">{formatMoney(totalAmount)}</div>
        </div>
        <ExportButtons
          title="Sales Returns"
          filename="sales_returns"
          columns={[
            { key: 'return_number', label: 'Return #' },
            { key: 'date', label: 'Date' },
            { key: 'invoice_number', label: 'Invoice #' },
            { key: 'customer', label: 'Customer' },
            { key: 'channel', label: 'Channel' },
            { key: 'reason', label: 'Reason' },
            { key: 'total', label: 'Total', money: true },
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
                <th>Return #</th>
                <th>Date</th>
                <th>Invoice #</th>
                <th>Customer</th>
                <th>Channel</th>
                <th>Reason</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Fragment key={r.id}>
                  <tr>
                    <td>
                      <button className="btn-secondary" onClick={() => toggleExpand(r.id)}>
                        {expandedId === r.id ? '−' : '+'}
                      </button>
                    </td>
                    <td>{r.return_number}</td>
                    <td>{formatDate(r.date)}</td>
                    <td>{r.sale_invoices?.invoice_number ?? '—'}</td>
                    <td>{r.sale_invoices?.customers?.name ?? '—'}</td>
                    <td>{r.sale_invoices?.channel ?? '—'}</td>
                    <td>{r.reason || '—'}</td>
                    <td>{formatMoney(r.total)}</td>
                  </tr>
                  {expandedId === r.id && (
                    <tr>
                      <td></td>
                      <td colSpan={7}>
                        <table className="data-table">
                          <thead>
                            <tr>
                              <th>Item</th>
                              <th>Qty</th>
                              <th>Unit</th>
                              <th>Rate</th>
                              <th>Amount</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(itemsByReturn[r.id] ?? []).map((it) => (
                              <tr key={it.id}>
                                <td>{it.products?.name ?? '—'}</td>
                                <td>{it.quantity}</td>
                                <td>{it.unit}</td>
                                <td>{formatMoney(it.rate)}</td>
                                <td>{formatMoney(it.amount)}</td>
                              </tr>
                            ))}
                            {(itemsByReturn[r.id] ?? []).length === 0 && (
                              <tr>
                                <td colSpan={5} className="muted">
                                  No line items.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="muted">
                    No sales returns in this range.
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
