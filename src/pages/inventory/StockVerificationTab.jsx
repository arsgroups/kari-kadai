import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { formatDate, toISODate } from '../../lib/format'

const emptyForm = { date: toISODate(), product_id: '', counted_qty: '', note: '' }

export default function StockVerificationTab() {
  const [products, setProducts] = useState([])
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState(emptyForm)
  const [systemQty, setSystemQty] = useState(null)

  async function load() {
    setLoading(true)
    const [{ data: productData }, { data: historyData, error: historyError }] = await Promise.all([
      supabase.from('products').select('id, name, unit').eq('is_active', true).order('name'),
      supabase
        .from('stock_verifications')
        .select('id, date, system_qty, counted_qty, variance, note, products(name, unit)')
        .order('date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(100),
    ])
    setProducts(productData ?? [])
    if (historyError) setError(historyError.message)
    else setHistory(historyData ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  async function handleProductChange(productId) {
    setForm({ ...form, product_id: productId })
    setSystemQty(null)
    if (!productId) return
    const { data } = await supabase
      .from('v_current_stock')
      .select('current_stock')
      .eq('product_id', productId)
      .single()
    setSystemQty(data?.current_stock ?? 0)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.product_id || form.counted_qty === '') return
    setSaving(true)
    setError('')

    const { error } = await supabase.from('stock_verifications').insert({
      date: form.date,
      product_id: form.product_id,
      system_qty: systemQty ?? 0,
      counted_qty: Number(form.counted_qty),
      note: form.note || null,
    })

    setSaving(false)
    if (error) {
      setError(error.message)
      return
    }
    setForm({ ...emptyForm, date: form.date })
    setSystemQty(null)
    load()
  }

  return (
    <div>
      <div className="card">
        <h3>Stock Verification</h3>
        <p className="muted" style={{ marginTop: '-0.5rem', fontSize: '0.85rem' }}>
          Records what you physically counted against the system's current stock. This is
          informational only — it does not change system stock.
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
            <select value={form.product_id} onChange={(e) => handleProductChange(e.target.value)} required>
              <option value="">Select…</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            System Stock
            <input value={systemQty === null ? '—' : systemQty} disabled />
          </label>
          <label>
            Counted Quantity
            <input
              type="number"
              step="0.01"
              value={form.counted_qty}
              onChange={(e) => setForm({ ...form, counted_qty: e.target.value })}
              required
            />
          </label>
          <label>
            Note
            <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </label>
          <button className="btn" type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save Verification'}
          </button>
        </form>
        {error && <div className="inline-error">{error}</div>}
      </div>

      <div className="card">
        <h3>Verification History</h3>
        {loading ? (
          <p className="muted">Loading…</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Product</th>
                <th>System Stock</th>
                <th>Counted</th>
                <th>Variance</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id}>
                  <td>{formatDate(h.date)}</td>
                  <td>{h.products?.name}</td>
                  <td>
                    {h.system_qty} {h.products?.unit}
                  </td>
                  <td>
                    {h.counted_qty} {h.products?.unit}
                  </td>
                  <td>
                    <span className={h.variance === 0 ? 'tag tag-success' : 'tag tag-danger'}>
                      {h.variance > 0 ? '+' : ''}
                      {h.variance}
                    </span>
                  </td>
                  <td>{h.note}</td>
                </tr>
              ))}
              {history.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    No verifications recorded yet.
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
