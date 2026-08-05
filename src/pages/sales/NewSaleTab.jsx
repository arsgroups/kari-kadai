import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { toISODate } from '../../lib/format'

const emptyForm = {
  date: toISODate(),
  product_id: '',
  quantity: '',
  unit_price: '',
  channel: 'Counter',
  customer_id: '',
  payment_type: 'Cash',
  gst_applicable: true,
  note: '',
}

export default function NewSaleTab() {
  const [products, setProducts] = useState([])
  const [customers, setCustomers] = useState([])
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    supabase
      .from('products')
      .select('id, name, unit')
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => setProducts(data ?? []))
    supabase
      .from('customers')
      .select('id, name, type')
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => setCustomers(data ?? []))
  }, [])

  const requiresCustomer = form.channel !== 'Counter'
  const filteredCustomers = useMemo(
    () => customers.filter((c) => c.type === form.channel),
    [customers, form.channel]
  )
  const total = (Number(form.quantity) || 0) * (Number(form.unit_price) || 0)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSuccess('')
    if (requiresCustomer && !form.customer_id) {
      setError('Please select a customer for Restaurant / Home Delivery sales.')
      return
    }
    setSaving(true)

    const { error: saleError } = await supabase.from('sales').insert({
      date: form.date,
      product_id: form.product_id,
      quantity: Number(form.quantity),
      unit_price: Number(form.unit_price),
      channel: form.channel,
      customer_id: requiresCustomer ? form.customer_id : null,
      payment_type: form.payment_type,
      gst_applicable: form.gst_applicable,
      note: form.note || null,
    })

    setSaving(false)
    if (saleError) {
      setError(saleError.message)
      return
    }

    // Stock movement is written automatically by a database trigger (see supabase/schema.sql),
    // so it's guaranteed to happen in the same transaction as the sale itself.
    setSuccess(`Sale recorded — total S$${total.toFixed(2)}`)
    setForm({ ...emptyForm, date: form.date, channel: form.channel })
  }

  return (
    <div className="card">
      <h3>New Sale</h3>
      <form className="form-grid" onSubmit={handleSubmit}>
        <label>
          Date
          <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
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
          Unit Price (SGD)
          <input
            type="number"
            step="0.01"
            min="0"
            value={form.unit_price}
            onChange={(e) => setForm({ ...form, unit_price: e.target.value })}
            required
          />
        </label>
        <label>
          Total
          <input value={`S$${total.toFixed(2)}`} disabled />
        </label>
        <label>
          Channel
          <select
            value={form.channel}
            onChange={(e) => setForm({ ...form, channel: e.target.value, customer_id: '' })}
          >
            <option>Counter</option>
            <option>Restaurant</option>
            <option>Home Delivery</option>
          </select>
        </label>
        {requiresCustomer && (
          <label>
            Customer
            <select value={form.customer_id} onChange={(e) => setForm({ ...form, customer_id: e.target.value })} required>
              <option value="">Select…</option>
              {filteredCustomers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
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
            <option value="yes">Yes (standard-rated)</option>
            <option value="no">No</option>
          </select>
        </label>
        <label>
          Note
          <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        </label>
        <button className="btn" type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Record Sale'}
        </button>
      </form>
      {form.payment_type === 'Credit' && requiresCustomer && (
        <p className="muted" style={{ fontSize: '0.85rem' }}>
          This will increase the selected customer's outstanding balance.
        </p>
      )}
      {error && <div className="inline-error">{error}</div>}
      {success && <div style={{ color: 'var(--success)', marginTop: '0.5rem' }}>{success}</div>}
    </div>
  )
}
