import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { formatMoney } from '../../lib/format'

export default function CustomerPricingTab() {
  const [customers, setCustomers] = useState([])
  const [products, setProducts] = useState([])
  const [customerId, setCustomerId] = useState('')
  const [prices, setPrices] = useState({}) // product_id -> price string
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    supabase.from('customers').select('id, name').eq('is_active', true).order('name').then(({ data }) => setCustomers(data ?? []))
    supabase
      .from('products')
      .select('id, name, unit, sales_unit, default_selling_price')
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => setProducts(data ?? []))
  }, [])

  useEffect(() => {
    if (!customerId) {
      setPrices({})
      return
    }
    loadPrices(customerId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId])

  async function loadPrices(id) {
    setLoading(true)
    const { data } = await supabase.from('customer_item_prices').select('product_id, price').eq('customer_id', id)
    const map = {}
    ;(data ?? []).forEach((row) => {
      map[row.product_id] = String(row.price)
    })
    setPrices(map)
    setLoading(false)
  }

  function setPrice(productId, value) {
    setPrices({ ...prices, [productId]: value })
  }

  async function handleSave() {
    if (!customerId) return
    setSaving(true)
    setError('')
    setSuccess('')

    const rows = Object.entries(prices)
      .filter(([, value]) => value !== '' && value != null)
      .map(([product_id, value]) => ({
        customer_id: customerId,
        product_id,
        price: Number(value),
      }))

    if (rows.length === 0) {
      setSaving(false)
      return
    }

    const { error } = await supabase.from('customer_item_prices').upsert(rows, { onConflict: 'customer_id,product_id' })
    setSaving(false)
    if (error) {
      setError(error.message)
      return
    }
    setSuccess('Pricing saved.')
  }

  return (
    <div>
      <div className="card">
        <h3>Per-Customer Pricing</h3>
        <p className="muted" style={{ fontSize: '0.85rem', marginTop: '-0.5rem' }}>
          Set a custom price per item for a customer. Selecting this customer on a Sales Invoice will
          load these prices automatically — still editable per line if needed. Leave blank to fall back
          to the item's default selling price.
        </p>
        <label style={{ display: 'block', maxWidth: 320 }}>
          Customer
          <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">Select a customer…</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {customerId && (
        <div className="card">
          {loading ? (
            <p className="muted">Loading…</p>
          ) : (
            <>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Default Price</th>
                    <th>Custom Price for this Customer</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((p) => (
                    <tr key={p.id}>
                      <td>
                        {p.name} <span className="muted">/ {p.sales_unit ?? p.unit}</span>
                      </td>
                      <td>{p.default_selling_price != null ? formatMoney(p.default_selling_price) : '—'}</td>
                      <td>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={prices[p.id] ?? ''}
                          placeholder={p.default_selling_price != null ? String(p.default_selling_price) : ''}
                          onChange={(e) => setPrice(p.id, e.target.value)}
                          style={{ width: 120 }}
                        />
                      </td>
                    </tr>
                  ))}
                  {products.length === 0 && (
                    <tr>
                      <td colSpan={3} className="muted">
                        No active items yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              <button className="btn" style={{ marginTop: '1rem' }} onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : 'Save Pricing'}
              </button>
              {error && <div className="inline-error">{error}</div>}
              {success && <div style={{ color: 'var(--success)', marginTop: '0.5rem' }}>{success}</div>}
            </>
          )}
        </div>
      )}
    </div>
  )
}
