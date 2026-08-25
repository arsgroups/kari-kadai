import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { formatDate, toISODate } from '../../lib/format'
import SearchableSelect from '../../components/SearchableSelect'

const MANUAL_TYPES = [
  { value: 'opening', label: 'Opening Stock (stock in)' },
  { value: 'wastage', label: 'Wastage (stock out)' },
  { value: 'adjustment_in', label: 'Adjustment — Increase' },
  { value: 'adjustment_out', label: 'Adjustment — Decrease' },
]

const emptyForm = {
  date: toISODate(),
  product_id: '',
  movement_type: 'opening',
  quantity: '',
  note: '',
}

export default function StockMovementsTab() {
  const [products, setProducts] = useState([])
  const [movements, setMovements] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [filterProduct, setFilterProduct] = useState('')

  async function load() {
    setLoading(true)
    const [{ data: productData }, { data: moveData, error: moveError }] = await Promise.all([
      supabase.from('products').select('id, name, unit').eq('is_active', true).order('name'),
      supabase
        .from('stock_movements')
        .select('id, date, movement_type, quantity, note, products(name, unit)')
        .order('date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(200),
    ])
    setProducts(productData ?? [])
    if (moveError) setError(moveError.message)
    else setMovements(moveData ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (!form.product_id || !form.quantity) return
    setSaving(true)

    let movement_type = form.movement_type
    let quantity = Number(form.quantity)

    if (movement_type === 'wastage') {
      movement_type = 'wastage'
      quantity = -Math.abs(quantity)
    } else if (movement_type === 'adjustment_in') {
      movement_type = 'adjustment'
      quantity = Math.abs(quantity)
    } else if (movement_type === 'adjustment_out') {
      movement_type = 'adjustment'
      quantity = -Math.abs(quantity)
    } else {
      quantity = Math.abs(quantity) // opening
    }

    const { error } = await supabase.from('stock_movements').insert({
      date: form.date,
      product_id: form.product_id,
      movement_type,
      quantity,
      reference_type: 'manual',
      note: form.note || null,
    })

    setSaving(false)
    if (error) {
      setError(error.message)
      return
    }
    setForm({ ...emptyForm, date: form.date })
    load()
  }

  const filtered = filterProduct
    ? movements.filter((m) => m.products?.name === filterProduct)
    : movements

  const productNames = [...new Set(movements.map((m) => m.products?.name).filter(Boolean))]

  return (
    <div>
      <div className="card">
        <h3>Log Stock Movement</h3>
        <p className="muted" style={{ marginTop: '-0.5rem', fontSize: '0.85rem' }}>
          Purchases and Sales entries automatically log their own stock-in / stock-out — use this
          form only for opening stock, wastage, or manual adjustments.
        </p>
        <form className="form-grid" onSubmit={handleSubmit}>
          <label>
            Date
            <input
              type="date"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
              required
            />
          </label>
          <label>
            Product
            <SearchableSelect
              value={form.product_id}
              onChange={(id) => setForm({ ...form, product_id: id })}
              placeholder="Select…"
              options={products.map((p) => ({ value: p.id, label: p.name }))}
            />
          </label>
          <label>
            Type
            <select
              value={form.movement_type}
              onChange={(e) => setForm({ ...form, movement_type: e.target.value })}
            >
              {MANUAL_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Quantity
            <input
              type="number"
              step="0.01"
              min="0"
              value={form.quantity}
              onChange={(e) => setForm({ ...form, quantity: e.target.value })}
              required
            />
          </label>
          <label>
            Note
            <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </label>
          <button className="btn" type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Add Movement'}
          </button>
        </form>
        {error && <div className="inline-error">{error}</div>}
      </div>

      <div className="card">
        <div className="toolbar">
          <h3 style={{ margin: 0 }}>Movement History</h3>
          <SearchableSelect
            value={filterProduct}
            onChange={setFilterProduct}
            placeholder="All products"
            options={[{ value: '', label: 'All products' }, ...productNames.map((n) => ({ value: n, label: n }))]}
          />
        </div>
        {loading ? (
          <p className="muted">Loading…</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Product</th>
                <th>Type</th>
                <th>Quantity</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((m) => (
                <tr key={m.id}>
                  <td>{formatDate(m.date)}</td>
                  <td>{m.products?.name}</td>
                  <td>
                    <span
                      className={
                        m.quantity >= 0 ? 'tag tag-success' : 'tag tag-danger'
                      }
                    >
                      {m.movement_type}
                    </span>
                  </td>
                  <td>
                    {m.quantity > 0 ? '+' : ''}
                    {m.quantity} {m.products?.unit}
                  </td>
                  <td>{m.note}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    No movements yet.
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
