import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { toISODate } from '../../lib/format'

const emptyForm = {
  id: null,
  name: '',
  category: '',
  description: '',
  unit: 'kg',
  purchase_unit: 'kg',
  sales_unit: 'kg',
  purchase_to_inventory_factor: 1,
  sales_to_inventory_factor: 1,
  default_purchase_price: '',
  default_selling_price: '',
  low_stock_threshold: 0,
  opening_stock: 0,
  opening_stock_value: 0,
  opening_stock_date: toISODate(),
  is_active: true,
}

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

  async function startEdit(row) {
    const { data } = await supabase.from('products').select('*').eq('id', row.product_id).single()
    if (!data) return
    setForm({
      id: data.id,
      name: data.name,
      category: data.category,
      description: data.description ?? '',
      unit: data.unit,
      purchase_unit: data.purchase_unit,
      sales_unit: data.sales_unit,
      purchase_to_inventory_factor: data.purchase_to_inventory_factor,
      sales_to_inventory_factor: data.sales_to_inventory_factor,
      default_purchase_price: data.default_purchase_price ?? '',
      default_selling_price: data.default_selling_price ?? '',
      low_stock_threshold: data.low_stock_threshold,
      opening_stock: data.opening_stock,
      opening_stock_value: data.opening_stock_value,
      opening_stock_date: data.opening_stock_date ?? toISODate(),
      is_active: data.is_active,
      item_code: data.item_code,
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
      description: form.description || null,
      unit: form.unit || 'kg',
      purchase_unit: form.purchase_unit || form.unit || 'kg',
      sales_unit: form.sales_unit || form.unit || 'kg',
      purchase_to_inventory_factor: Number(form.purchase_to_inventory_factor) || 1,
      sales_to_inventory_factor: Number(form.sales_to_inventory_factor) || 1,
      default_purchase_price: form.default_purchase_price === '' ? null : Number(form.default_purchase_price),
      default_selling_price: form.default_selling_price === '' ? null : Number(form.default_selling_price),
      low_stock_threshold: Number(form.low_stock_threshold) || 0,
      is_active: form.is_active,
    }
    if (!form.id) {
      // Opening stock only applies at creation — editing later shouldn't re-log a movement.
      payload.opening_stock = Number(form.opening_stock) || 0
      payload.opening_stock_value = Number(form.opening_stock_value) || 0
      payload.opening_stock_date = form.opening_stock_date || toISODate()
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
          + Add Item
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
          <h3>{form.id ? `Edit Item ${form.item_code ? `(${form.item_code})` : ''}` : 'New Item'}</h3>
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
              Description
              <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </label>
            <label>
              Inventory Unit
              <input
                value={form.unit}
                onChange={(e) => setForm({ ...form, unit: e.target.value })}
                placeholder="kg"
              />
            </label>
            <label>
              Purchase Unit
              <input
                value={form.purchase_unit}
                onChange={(e) => setForm({ ...form, purchase_unit: e.target.value })}
                placeholder="e.g. Carton, KG"
              />
            </label>
            <label>
              1 Purchase Unit = how many Inventory Units?
              <input
                type="number"
                step="0.0001"
                min="0"
                value={form.purchase_to_inventory_factor}
                onChange={(e) => setForm({ ...form, purchase_to_inventory_factor: e.target.value })}
              />
            </label>
            <label>
              Sales Unit
              <input
                value={form.sales_unit}
                onChange={(e) => setForm({ ...form, sales_unit: e.target.value })}
                placeholder="e.g. Unit, KG"
              />
            </label>
            <label>
              1 Sales Unit = how many Inventory Units?
              <input
                type="number"
                step="0.0001"
                min="0"
                value={form.sales_to_inventory_factor}
                onChange={(e) => setForm({ ...form, sales_to_inventory_factor: e.target.value })}
              />
            </label>
            <label>
              Default Purchase Price
              <input
                type="number"
                step="0.01"
                value={form.default_purchase_price}
                onChange={(e) => setForm({ ...form, default_purchase_price: e.target.value })}
              />
            </label>
            <label>
              Default Selling Price
              <input
                type="number"
                step="0.01"
                value={form.default_selling_price}
                onChange={(e) => setForm({ ...form, default_selling_price: e.target.value })}
              />
            </label>
            <label>
              Minimum Stock
              <input
                type="number"
                step="0.01"
                value={form.low_stock_threshold}
                onChange={(e) => setForm({ ...form, low_stock_threshold: e.target.value })}
              />
            </label>
            {!form.id && (
              <>
                <label>
                  Opening Stock
                  <input
                    type="number"
                    step="0.01"
                    value={form.opening_stock}
                    onChange={(e) => setForm({ ...form, opening_stock: e.target.value })}
                  />
                </label>
                <label>
                  Opening Stock Value (SGD)
                  <input
                    type="number"
                    step="0.01"
                    value={form.opening_stock_value}
                    onChange={(e) => setForm({ ...form, opening_stock_value: e.target.value })}
                  />
                </label>
                <label>
                  Opening Stock Date
                  <input
                    type="date"
                    value={form.opening_stock_date}
                    onChange={(e) => setForm({ ...form, opening_stock_date: e.target.value })}
                  />
                </label>
              </>
            )}
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
                <th>Item Code</th>
                <th>Name</th>
                <th>Category</th>
                <th>Purchase Unit</th>
                <th>Sales Unit</th>
                <th>Current Stock</th>
                <th>Min Stock</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((r) => {
                const low = r.current_stock <= r.low_stock_threshold
                return (
                  <tr key={r.product_id}>
                    <td>{r.item_code}</td>
                    <td>{r.name}</td>
                    <td>{r.category}</td>
                    <td>{r.purchase_unit}</td>
                    <td>{r.sales_unit}</td>
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
                  <td colSpan={9} className="muted">
                    No items found.
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
