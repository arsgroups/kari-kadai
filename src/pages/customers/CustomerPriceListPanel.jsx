import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { formatMoney } from '../../lib/format'

export default function CustomerPriceListPanel({ customerId }) {
  const [products, setProducts] = useState([])
  const [prices, setPrices] = useState({}) // product_id -> { price, updated_at }
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId])

  async function load() {
    setLoading(true)
    const [{ data: productData }, { data: priceData }] = await Promise.all([
      supabase
        .from('products')
        .select('id, name, category, default_selling_price')
        .eq('is_active', true)
        .order('name'),
      supabase.from('customer_item_prices').select('product_id, price, updated_at').eq('customer_id', customerId),
    ])
    setProducts(productData ?? [])
    const map = {}
    ;(priceData ?? []).forEach((row) => {
      map[row.product_id] = { price: String(row.price), updated_at: row.updated_at }
    })
    setPrices(map)
    setLoading(false)
  }

  function setPrice(productId, value) {
    setPrices({ ...prices, [productId]: { ...prices[productId], price: value } })
  }

  async function handleSave() {
    setSaving(true)
    setError('')
    setSuccess('')

    const now = new Date().toISOString()
    const rows = Object.entries(prices)
      .filter(([, v]) => v.price !== '' && v.price != null)
      .map(([product_id, v]) => ({
        customer_id: customerId,
        product_id,
        price: Number(v.price),
        updated_at: now,
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
    load()
  }

  return (
    <div>
      <p className="muted" style={{ fontSize: '0.85rem' }}>
        Leave a Customer Price blank to use the item's Default Selling Price. Selecting this customer
        on a Sales Invoice loads these prices automatically — still editable per line if needed.
      </p>

      {loading ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <table className="data-table">
            <thead>
              <tr>
                <th>Product Name</th>
                <th>Category</th>
                <th>Default Price</th>
                <th>Customer Price</th>
                <th>Last Updated</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{p.category}</td>
                  <td>{p.default_selling_price != null ? formatMoney(p.default_selling_price) : '—'}</td>
                  <td>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={prices[p.id]?.price ?? ''}
                      placeholder={p.default_selling_price != null ? String(p.default_selling_price) : ''}
                      onChange={(e) => setPrice(p.id, e.target.value)}
                      style={{ width: 110 }}
                    />
                  </td>
                  <td>{prices[p.id]?.updated_at ? new Date(prices[p.id].updated_at).toLocaleString('en-SG') : '—'}</td>
                </tr>
              ))}
              {products.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
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
  )
}
