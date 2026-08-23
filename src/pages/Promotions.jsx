import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { formatDate, formatMoney, toISODate } from '../lib/format'

const emptyForm = {
  id: null,
  name: '',
  product_id: '',
  promo_type: 'discount',
  discount_type: 'percent',
  discount_value: '',
  buy_qty: '',
  free_qty: '',
  free_product_id: '',
  start_date: toISODate(),
  end_date: toISODate(),
  is_active: true,
}

function promoStatus(p) {
  if (!p.is_active) return 'Inactive'
  const today = toISODate()
  if (today < p.start_date) return 'Upcoming'
  if (today > p.end_date) return 'Expired'
  return 'Active'
}

function promoDetails(p) {
  if (p.promo_type === 'discount') {
    return p.discount_type === 'percent' ? `${p.discount_value}% off` : `${formatMoney(p.discount_value)} off`
  }
  const freeName = p.free_products?.name ?? p.products?.name
  return `Buy ${p.buy_qty} ${p.products?.name ?? ''}, Get ${p.free_qty} ${freeName ?? ''} Free`
}

export default function Promotions() {
  const [rows, setRows] = useState([])
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [form, setForm] = useState(emptyForm)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)

  async function load() {
    setLoading(true)
    const [{ data: promoData, error: promoError }, { data: productData }] = await Promise.all([
      supabase
        .from('promotions')
        .select('*, products!promotions_product_id_fkey(name), free_products:products!promotions_free_product_id_fkey(name)')
        .order('start_date', { ascending: false }),
      supabase.from('products').select('id, name').eq('is_active', true).order('name'),
    ])
    if (promoError) setError(promoError.message)
    else setRows(promoData ?? [])
    setProducts(productData ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  function startNew() {
    setForm(emptyForm)
    setShowForm(true)
  }

  function startEdit(p) {
    setForm({
      id: p.id,
      name: p.name,
      product_id: p.product_id,
      promo_type: p.promo_type,
      discount_type: p.discount_type ?? 'percent',
      discount_value: p.discount_value ?? '',
      buy_qty: p.buy_qty ?? '',
      free_qty: p.free_qty ?? '',
      free_product_id: p.free_product_id ?? p.product_id ?? '',
      start_date: p.start_date,
      end_date: p.end_date,
      is_active: p.is_active,
    })
    setShowForm(true)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (!form.product_id) {
      setError('Select an item for this promotion.')
      return
    }
    if (form.end_date < form.start_date) {
      setError('End date must be on or after the start date.')
      return
    }
    setSaving(true)
    const payload = {
      name: form.name,
      product_id: form.product_id,
      promo_type: form.promo_type,
      discount_type: form.promo_type === 'discount' ? form.discount_type : null,
      discount_value: form.promo_type === 'discount' ? Number(form.discount_value) || 0 : null,
      buy_qty: form.promo_type === 'buy_x_get_y' ? Number(form.buy_qty) || 0 : null,
      free_qty: form.promo_type === 'buy_x_get_y' ? Number(form.free_qty) || 0 : null,
      free_product_id: form.promo_type === 'buy_x_get_y' ? form.free_product_id || form.product_id : null,
      start_date: form.start_date,
      end_date: form.end_date,
      is_active: form.is_active,
    }
    const { error } = form.id
      ? await supabase.from('promotions').update(payload).eq('id', form.id)
      : await supabase.from('promotions').insert(payload)
    setSaving(false)
    if (error) {
      setError(error.message)
      return
    }
    setShowForm(false)
    setForm(emptyForm)
    load()
  }

  async function handleDelete() {
    if (!form.id) return
    if (!window.confirm(`Delete promotion "${form.name}"? This cannot be undone.`)) return
    setSaving(true)
    setError('')
    const { error } = await supabase.from('promotions').delete().eq('id', form.id)
    setSaving(false)
    if (error) {
      setError(error.message)
      return
    }
    setShowForm(false)
    setForm(emptyForm)
    load()
  }

  return (
    <div className="page">
      <h1>Promotions</h1>
      <p className="muted" style={{ fontSize: '0.85rem' }}>
        Define a time-bound offer — a discount (percent or fixed amount) on one item, or a Buy X Get Y Free
        deal where the free item can be the same item or a different one (e.g. Buy 5 Kg Chicken, Get 1 Unit
        Wings free — each item's own Kg/Unit quantity is used). While a Sale Invoice's date falls within the
        period, it's applied automatically: the Discount column fills in for a discount promo, and a separate
        $0 line for the free item/quantity is added for a Buy X Get Y deal.
      </p>

      <div className="toolbar">
        <button className="btn" onClick={startNew}>
          + New Promotion
        </button>
      </div>

      {showForm && (
        <div className="card">
          <h3>{form.id ? 'Edit Promotion' : 'New Promotion'}</h3>
          <form className="form-grid" onSubmit={handleSubmit}>
            <label>
              Promotion Name
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Chicken Breast October Sale"
                required
              />
            </label>
            <label>
              {form.promo_type === 'buy_x_get_y' ? 'Buy Item' : 'Item'}
              <select value={form.product_id} onChange={(e) => setForm({ ...form, product_id: e.target.value })} required>
                <option value="">Select…</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Promotion Type
              <select value={form.promo_type} onChange={(e) => setForm({ ...form, promo_type: e.target.value })}>
                <option value="discount">Price Discount</option>
                <option value="buy_x_get_y">Buy X Get Y Free</option>
              </select>
            </label>
            {form.promo_type === 'discount' ? (
              <>
                <label>
                  Discount Type
                  <select
                    value={form.discount_type}
                    onChange={(e) => setForm({ ...form, discount_type: e.target.value })}
                  >
                    <option value="percent">Percent (%)</option>
                    <option value="fixed">Fixed Amount (SGD per unit)</option>
                  </select>
                </label>
                <label>
                  Discount Value
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.discount_value}
                    onChange={(e) => setForm({ ...form, discount_value: e.target.value })}
                    required
                  />
                </label>
              </>
            ) : (
              <>
                <label>
                  Buy Quantity
                  <input
                    type="number"
                    step="1"
                    min="1"
                    value={form.buy_qty}
                    onChange={(e) => setForm({ ...form, buy_qty: e.target.value })}
                    required
                  />
                </label>
                <label>
                  Free Item
                  <select
                    value={form.free_product_id}
                    onChange={(e) => setForm({ ...form, free_product_id: e.target.value })}
                    required
                  >
                    <option value="">Same as Buy Item</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Free Quantity
                  <input
                    type="number"
                    step="1"
                    min="1"
                    value={form.free_qty}
                    onChange={(e) => setForm({ ...form, free_qty: e.target.value })}
                    required
                  />
                </label>
              </>
            )}
            <label>
              Start Date
              <input
                type="date"
                value={form.start_date}
                onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                required
              />
            </label>
            <label>
              End Date
              <input
                type="date"
                value={form.end_date}
                onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                required
              />
            </label>
            <label>
              <span style={{ display: 'block', marginBottom: '0.3rem' }}>Status</span>
              <select
                value={form.is_active ? 'active' : 'inactive'}
                onChange={(e) => setForm({ ...form, is_active: e.target.value === 'active' })}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive (paused)</option>
              </select>
            </label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button className="btn" type="submit" disabled={saving}>
                {saving ? 'Saving…' : 'Save Promotion'}
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
              {form.id && (
                <button type="button" className="btn-danger" disabled={saving} onClick={handleDelete}>
                  Delete
                </button>
              )}
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
                <th>Item</th>
                <th>Type</th>
                <th>Details</th>
                <th>Period</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const status = promoStatus(p)
                return (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td>{p.products?.name}</td>
                    <td>{p.promo_type === 'discount' ? 'Discount' : 'Buy X Get Y Free'}</td>
                    <td>{promoDetails(p)}</td>
                    <td>
                      {formatDate(p.start_date)} – {formatDate(p.end_date)}
                    </td>
                    <td>
                      <span
                        className={
                          status === 'Active'
                            ? 'tag tag-success'
                            : status === 'Upcoming'
                              ? 'tag tag-warning'
                              : 'tag tag-muted'
                        }
                      >
                        {status}
                      </span>
                    </td>
                    <td>
                      <button className="btn-secondary" onClick={() => startEdit(p)}>
                        Edit
                      </button>
                    </td>
                  </tr>
                )
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted">
                    No promotions yet.
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
