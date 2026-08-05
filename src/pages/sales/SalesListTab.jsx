import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { formatDate, formatMoney, toISODate } from '../../lib/format'
import ExportButtons from '../../components/ExportButtons'

function firstOfMonth() {
  const d = new Date()
  return toISODate(new Date(d.getFullYear(), d.getMonth(), 1))
}

const emptyFilters = { from: firstOfMonth(), to: toISODate(), channel: '', product_id: '', customer_id: '' }

export default function SalesListTab() {
  const [rows, setRows] = useState([])
  const [products, setProducts] = useState([])
  const [customers, setCustomers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filters, setFilters] = useState(emptyFilters)

  useEffect(() => {
    supabase.from('products').select('id, name').order('name').then(({ data }) => setProducts(data ?? []))
    supabase.from('customers').select('id, name').order('name').then(({ data }) => setCustomers(data ?? []))
  }, [])

  async function load() {
    setLoading(true)
    setError('')
    let query = supabase
      .from('sales')
      .select('id, date, quantity, unit_price, total, channel, payment_type, note, products(name, unit), customers(name)')
      .gte('date', filters.from)
      .lte('date', filters.to)
      .order('date', { ascending: false })

    if (filters.channel) query = query.eq('channel', filters.channel)
    if (filters.product_id) query = query.eq('product_id', filters.product_id)
    if (filters.customer_id) query = query.eq('customer_id', filters.customer_id)

    const { data, error } = await query.limit(500)
    if (error) setError(error.message)
    else setRows(data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters])

  const totalAmount = rows.reduce((sum, r) => sum + r.total, 0)

  const exportRows = rows.map((r) => ({
    date: formatDate(r.date),
    product: r.products?.name,
    quantity: r.quantity,
    unit_price: r.unit_price,
    total: r.total,
    channel: r.channel,
    customer: r.customers?.name ?? '',
    payment_type: r.payment_type,
  }))

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
              <option>Counter</option>
              <option>Restaurant</option>
              <option>Home Delivery</option>
            </select>
          </label>
          <label>
            Product
            <select value={filters.product_id} onChange={(e) => setFilters({ ...filters, product_id: e.target.value })}>
              <option value="">All</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Customer
            <select value={filters.customer_id} onChange={(e) => setFilters({ ...filters, customer_id: e.target.value })}>
              <option value="">All</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="toolbar">
        <div className="tile" style={{ margin: 0 }}>
          <div className="tile-label">Total (filtered)</div>
          <div className="tile-value">{formatMoney(totalAmount)}</div>
        </div>
        <ExportButtons
          title="Sales"
          filename="sales"
          columns={[
            { key: 'date', label: 'Date' },
            { key: 'product', label: 'Product' },
            { key: 'quantity', label: 'Qty' },
            { key: 'unit_price', label: 'Unit Price' },
            { key: 'total', label: 'Total' },
            { key: 'channel', label: 'Channel' },
            { key: 'customer', label: 'Customer' },
            { key: 'payment_type', label: 'Payment' },
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
                <th>Date</th>
                <th>Product</th>
                <th>Qty</th>
                <th>Unit Price</th>
                <th>Total</th>
                <th>Channel</th>
                <th>Customer</th>
                <th>Payment</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{formatDate(r.date)}</td>
                  <td>{r.products?.name}</td>
                  <td>
                    {r.quantity} {r.products?.unit}
                  </td>
                  <td>{formatMoney(r.unit_price)}</td>
                  <td>{formatMoney(r.total)}</td>
                  <td>{r.channel}</td>
                  <td>{r.customers?.name ?? '—'}</td>
                  <td>
                    <span className={r.payment_type === 'Credit' ? 'tag tag-warning' : 'tag tag-success'}>
                      {r.payment_type}
                    </span>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="muted">
                    No sales in this range.
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
