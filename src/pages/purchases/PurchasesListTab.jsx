import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { formatDate, formatMoney, toISODate } from '../../lib/format'
import ExportButtons from '../../components/ExportButtons'

function firstOfMonth() {
  const d = new Date()
  return toISODate(new Date(d.getFullYear(), d.getMonth(), 1))
}

const emptyFilters = { from: firstOfMonth(), to: toISODate(), supplier_id: '', product_id: '', source: '' }

export default function PurchasesListTab() {
  const [rows, setRows] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filters, setFilters] = useState(emptyFilters)

  useEffect(() => {
    supabase.from('suppliers').select('id, name').order('name').then(({ data }) => setSuppliers(data ?? []))
    supabase.from('products').select('id, name').order('name').then(({ data }) => setProducts(data ?? []))
  }, [])

  async function load() {
    setLoading(true)
    setError('')
    let query = supabase
      .from('purchases')
      .select(
        'id, date, quantity, cost_price, total, payment_type, source, note, products(name, unit), suppliers(name)'
      )
      .gte('date', filters.from)
      .lte('date', filters.to)
      .order('date', { ascending: false })

    if (filters.supplier_id) query = query.eq('supplier_id', filters.supplier_id)
    if (filters.product_id) query = query.eq('product_id', filters.product_id)
    if (filters.source) query = query.eq('source', filters.source)

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
    supplier: r.suppliers?.name,
    product: r.products?.name,
    quantity: r.quantity,
    cost_price: r.cost_price,
    total: r.total,
    payment_type: r.payment_type,
    source: r.source,
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
            Supplier
            <select value={filters.supplier_id} onChange={(e) => setFilters({ ...filters, supplier_id: e.target.value })}>
              <option value="">All</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
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
            Source
            <select value={filters.source} onChange={(e) => setFilters({ ...filters, source: e.target.value })}>
              <option value="">All</option>
              <option value="manual">Manually entered</option>
              <option value="imported">Imported from accounting app</option>
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
          title="Purchases"
          filename="purchases"
          columns={[
            { key: 'date', label: 'Date' },
            { key: 'supplier', label: 'Supplier' },
            { key: 'product', label: 'Product' },
            { key: 'quantity', label: 'Qty' },
            { key: 'cost_price', label: 'Cost Price' },
            { key: 'total', label: 'Total' },
            { key: 'payment_type', label: 'Payment' },
            { key: 'source', label: 'Source' },
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
                <th>Supplier</th>
                <th>Product</th>
                <th>Qty</th>
                <th>Cost Price</th>
                <th>Total</th>
                <th>Payment</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{formatDate(r.date)}</td>
                  <td>{r.suppliers?.name}</td>
                  <td>{r.products?.name}</td>
                  <td>
                    {r.quantity} {r.products?.unit}
                  </td>
                  <td>{formatMoney(r.cost_price)}</td>
                  <td>{formatMoney(r.total)}</td>
                  <td>
                    <span className={r.payment_type === 'Credit' ? 'tag tag-warning' : 'tag tag-success'}>
                      {r.payment_type}
                    </span>
                  </td>
                  <td>
                    <span className={r.source === 'imported' ? 'tag tag-muted' : 'tag tag-success'}>
                      {r.source === 'imported' ? 'Imported' : 'Manual'}
                    </span>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="muted">
                    No purchases in this range.
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
