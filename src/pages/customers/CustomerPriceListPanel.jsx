import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { formatMoney } from '../../lib/format'

export default function CustomerPriceListPanel({ customerId, customerType }) {
  const [products, setProducts] = useState([])
  const [prices, setPrices] = useState({}) // product_id -> { price, updated_at }
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId, customerType])

  async function load() {
    setLoading(true)
    const [{ data: productData }, { data: channelData }, { data: priceData }] = await Promise.all([
      supabase
        .from('products')
        .select('id, name, category, default_selling_price, restaurant_price, counter_price, supplier_only')
        .eq('is_active', true)
        .order('name'),
      supabase.from('product_channel_config').select('product_id, channel, display_name, is_visible'),
      supabase.from('customer_item_prices').select('product_id, price, updated_at').eq('customer_id', customerId),
    ])

    const channelMap = {}
    ;(channelData ?? []).forEach((row) => {
      if (!channelMap[row.product_id]) channelMap[row.product_id] = {}
      channelMap[row.product_id][row.channel] = { display_name: row.display_name, is_visible: row.is_visible }
    })

    // Same channel a customer's type maps to on the Sales invoice ('Restaurant'
    // or 'Home Delivery') — only items actually offered there are worth pricing.
    const visible = (productData ?? [])
      .filter((p) => !p.supplier_only && channelMap[p.id]?.[customerType]?.is_visible !== false)
      .map((p) => {
        const channelPrice = customerType === 'Restaurant' ? p.restaurant_price : p.counter_price
        return {
          ...p,
          displayName: channelMap[p.id]?.[customerType]?.display_name || p.name,
          channelDefaultPrice: channelPrice ?? p.default_selling_price,
        }
      })
    setProducts(visible)

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
        Only items offered on this customer's channel ({customerType}) are listed. Default Price is that item's{' '}
        {customerType} selling price (falls back to its Default Selling Price if not set). Leave Customer Price
        blank to keep using that — type an amount to set this customer's exclusive price, which the Sales Invoice
        will use instead once this customer is selected.
      </p>

      {loading ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <div className="table-scroll">
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
                    <td>{p.displayName}</td>
                    <td>{p.category}</td>
                    <td>{p.channelDefaultPrice != null ? formatMoney(p.channelDefaultPrice) : '—'}</td>
                    <td>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={prices[p.id]?.price ?? ''}
                        placeholder={p.channelDefaultPrice != null ? String(p.channelDefaultPrice) : ''}
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
                      No items are offered on this customer's channel yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
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
