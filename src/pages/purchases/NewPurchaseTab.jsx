import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { toISODate } from '../../lib/format'

const emptyForm = {
  date: toISODate(),
  supplier_id: '',
  product_id: '',
  quantity: '',
  cost_price: '',
  payment_type: 'Cash',
  gst_applicable: true,
  note: '',
}

export default function NewPurchaseTab() {
  const [suppliers, setSuppliers] = useState([])
  const [products, setProducts] = useState([])
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    supabase
      .from('suppliers')
      .select('id, name, gst_registered')
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => setSuppliers(data ?? []))
    supabase
      .from('products')
      .select('id, name, unit')
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => setProducts(data ?? []))
  }, [])

  const total = (Number(form.quantity) || 0) * (Number(form.cost_price) || 0)

  function handleSupplierChange(supplierId) {
    const supplier = suppliers.find((s) => s.id === supplierId)
    setForm({ ...form, supplier_id: supplierId, gst_applicable: supplier ? supplier.gst_registered : true })
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSuccess('')
    setSaving(true)

    const { error: purchaseError } = await supabase.from('purchases').insert({
      date: form.date,
      supplier_id: form.supplier_id,
      product_id: form.product_id,
      quantity: Number(form.quantity),
      cost_price: Number(form.cost_price),
      payment_type: form.payment_type,
      source: 'manual',
      gst_applicable: form.gst_applicable,
      note: form.note || null,
    })

    setSaving(false)
    if (purchaseError) {
      setError(purchaseError.message)
      return
    }

    // Stock movement is written automatically by a database trigger (see supabase/schema.sql).
    setSuccess(`Purchase recorded — total S$${total.toFixed(2)}`)
    setForm({ ...emptyForm, date: form.date })
  }

  return (
    <div className="card">
      <h3>New Purchase</h3>
      <form className="form-grid" onSubmit={handleSubmit}>
        <label>
          Date
          <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
        </label>
        <label>
          Supplier
          <select value={form.supplier_id} onChange={(e) => handleSupplierChange(e.target.value)} required>
            <option value="">Select…</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Product
          <select value={form.product_id} onChange={(e) => setForm({ ...form, product_id: e.target.value })} required>
            <option value="">Select…</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.unit})
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
          Cost Price (SGD)
          <input
            type="number"
            step="0.01"
            min="0"
            value={form.cost_price}
            onChange={(e) => setForm({ ...form, cost_price: e.target.value })}
            required
          />
        </label>
        <label>
          Total
          <input value={`S$${total.toFixed(2)}`} disabled />
        </label>
        <label>
          Payment Type
          <select value={form.payment_type} onChange={(e) => setForm({ ...form, payment_type: e.target.value })}>
            <option>Cash</option>
            <option>Bank</option>
            <option>Credit</option>
          </select>
        </label>
        <label>
          <span style={{ display: 'block', marginBottom: '0.3rem' }}>GST Applicable?</span>
          <select
            value={form.gst_applicable ? 'yes' : 'no'}
            onChange={(e) => setForm({ ...form, gst_applicable: e.target.value === 'yes' })}
          >
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </label>
        <label>
          Note
          <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        </label>
        <button className="btn" type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Record Purchase'}
        </button>
      </form>
      {form.payment_type === 'Credit' && (
        <p className="muted" style={{ fontSize: '0.85rem' }}>
          This will increase what you owe this supplier.
        </p>
      )}
      {error && <div className="inline-error">{error}</div>}
      {success && <div style={{ color: 'var(--success)', marginTop: '0.5rem' }}>{success}</div>}
    </div>
  )
}
