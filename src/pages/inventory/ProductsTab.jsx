import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'

const emptyForm = { id: null, name: '', category: '', unit: 'kg', low_stock_threshold: 0, is_active: true }

export default function ProductsTab() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [form, setForm] = useState(emptyForm)
  const [showForm, setShowForm] = useState(false)
  const [lowStockOnly, setLowStockOnly] = useState(false)
  const [saving, setSaving] = useState(false)

  async function load() {
    setLoading(true)
    const { data, error } = await supabase.from('v_current_stock').select('*').order('name')
    if (error) setError(error.message)
    else setRows(data)
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  function startEdit(row) {
    setForm({
      id: row.product_id,
      name: row.name,
      category: row.category,
      unit: row.unit,
      low_stock_threshold: row.low_stock_threshold,
      is_active: row.is_active,
    })
    setShowForm(true)
  }

  function startNew() {
    setForm(emptyForm)
    setShowForm(true)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    const payload = {
      name: form.name,
      category: form.category || 'Others',
      unit: form.unit || 'kg',
      low_stock_threshold: Number(form.low_stock_threshold) || 0,
      is_active: form.is_active,
    }
    const { error } = form.id
      ? await supabase.from('products').update(payload).eq('id', form.id)
      : await supabase.from('products').insert(payload)

    setSaving(false)
    if (error) {
      setError(error.message)
      return
    }
    setShowForm(false)
    setForm(emptyForm)
    load()
  }

  async function toggleActive(row) {
    await supabase.from('products').update({ is_active: !row.is_active }).eq('id', row.product_id)
    load()
  }

  const categories = [...new Set(rows.map((r) => r.category).filter(Boolean))]
  const visibleRows = lowStockOnly
    ? rows.filter((r) => r.current_stock <= r.low_stock_threshold)
    : rows

  return (
    <div>
      <div className="toolbar">
        <button className="btn" onClick={startNew}>
          + Add Product
        </button>
        <button
          className={lowStockOnly ? 'btn' : 'btn-secondary'}
          onClick={() => setLowStockOnly((v) => !v)}
        >
          {lowStockOnly ? 'Showing: Low stock only' : 'Show low stock only'}
        </button>
      </div>

      {showForm && (
        <div className="card">
          <h3>{form.id ? 'Edit Product' : 'New Product'}</h3>
          <form className="form-grid" onSubmit={handleSubmit}>
            <label>
              Name
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </label>
            <label>
              Category
              <input
                list="category-suggestions"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                placeholder="e.g. Mutton, Chicken, Others"
              />
              <datalist id="category-suggestions">
                {[...categories, 'Others'].map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </label>
            <label>
              Unit
              <input
                value={form.unit}
                onChange={(e) => setForm({ ...form, unit: e.target.value })}
                placeholder="kg"
              />
            </label>
            <label>
              Low Stock Threshold
              <input
                type="number"
                step="0.01"
                value={form.low_stock_threshold}
                onChange={(e) => setForm({ ...form, low_stock_threshold: e.target.value })}
              />
            </label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button className="btn" type="submit" disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setShowForm(false)
                  setForm(emptyForm)
                }}
              >
                Cancel
              </button>
            </div>
          </form>
          {error && <div className="inline-error">{error}</div>}
        </div>
      )}

      <div className="card">
        {loading ? (
          <p className="muted">Loading…</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Category</th>
                <th>Unit</th>
                <th>Current Stock</th>
                <th>Low Stock At</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((r) => {
                const low = r.current_stock <= r.low_stock_threshold
                return (
                  <tr key={r.product_id}>
                    <td>{r.name}</td>
                    <td>{r.category}</td>
                    <td>{r.unit}</td>
                    <td>
                      {r.current_stock} {r.unit}{' '}
                      {low && <span className="tag tag-danger">Low</span>}
                    </td>
                    <td>{r.low_stock_threshold}</td>
                    <td>
                      <span className={r.is_active ? 'tag tag-success' : 'tag tag-muted'}>
                        {r.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>
                      <button className="btn-secondary" onClick={() => startEdit(r)}>
                        Edit
                      </button>{' '}
                      <button className="btn-secondary" onClick={() => toggleActive(r)}>
                        {r.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                    </td>
                  </tr>
                )
              })}
              {visibleRows.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted">
                    No products found.
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
