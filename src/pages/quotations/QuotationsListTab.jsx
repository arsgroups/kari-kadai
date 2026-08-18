import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { formatDate, toISODate } from '../../lib/format'
import QuotationView from './QuotationView'

function firstOfMonth() {
  const d = new Date()
  return toISODate(new Date(d.getFullYear(), d.getMonth(), 1))
}

const emptyFilters = { from: firstOfMonth(), to: toISODate(), channel: '' }

export default function QuotationsListTab() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filters, setFilters] = useState(emptyFilters)
  const [viewingId, setViewingId] = useState(null)

  async function load() {
    setLoading(true)
    setError('')
    let query = supabase
      .from('quotations')
      .select('id, quotation_number, date, channel, customer_name')
      .gte('date', filters.from)
      .lte('date', filters.to)
      .order('date', { ascending: false })

    if (filters.channel) query = query.eq('channel', filters.channel)

    const { data, error } = await query.limit(500)
    if (error) setError(error.message)
    else setRows(data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters])

  if (viewingId) {
    return (
      <QuotationView
        quotationId={viewingId}
        onClose={() => setViewingId(null)}
        onDeleted={() => {
          setViewingId(null)
          load()
        }}
      />
    )
  }

  return (
    <div>
      <div className="card">
        <div className="form-grid">
          <label>
            From
            <input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
          </label>
          <label>
            To
            <input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
          </label>
          <label>
            Channel
            <select value={filters.channel} onChange={(e) => setFilters({ ...filters, channel: e.target.value })}>
              <option value="">All</option>
              <option>Restaurant</option>
              <option>Home Delivery</option>
              <option>Counter</option>
            </select>
          </label>
        </div>
      </div>

      <div className="card">
        {error && <div className="inline-error">{error}</div>}
        {loading ? (
          <p className="muted">Loading…</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Quotation #</th>
                <th>Date</th>
                <th>Channel</th>
                <th>Customer</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.quotation_number}</td>
                  <td>{formatDate(r.date)}</td>
                  <td>{r.channel}</td>
                  <td>{r.customer_name}</td>
                  <td>
                    <button className="btn-secondary" onClick={() => setViewingId(r.id)}>
                      View / Print
                    </button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    No quotations in this range.
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
