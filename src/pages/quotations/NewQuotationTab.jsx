import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { toISODate, formatMoney } from '../../lib/format'
import QuotationView from './QuotationView'

export default function NewQuotationTab() {
  const [products, setProducts] = useState([])
  const [channelConfig, setChannelConfig] = useState({}) // product_id -> { [channel]: { display_name, is_visible } }

  const [channel, setChannel] = useState('Restaurant')
  const [date, setDate] = useState(toISODate())
  const [customerName, setCustomerName] = useState('')
  const [customerAddress, setCustomerAddress] = useState('')
  const [customerContact, setCustomerContact] = useState('')
  const [sentByName, setSentByName] = useState('')
  const [sentByContact, setSentByContact] = useState('')
  const [removedIds, setRemovedIds] = useState(() => new Set())
  const [specialPrices, setSpecialPrices] = useState({}) // product_id -> value
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [savedQuotationId, setSavedQuotationId] = useState(null)

  useEffect(() => {
    Promise.all([
      supabase
        .from('products')
        .select('id, name, sales_unit, default_selling_price, restaurant_price, counter_price, supplier_only')
        .eq('is_active', true)
        .order('name'),
      supabase.from('product_channel_config').select('product_id, channel, display_name, is_visible'),
    ]).then(([{ data: productData }, { data: channelData }]) => {
      const channelMap = {}
      ;(channelData ?? []).forEach((row) => {
        if (!channelMap[row.product_id]) channelMap[row.product_id] = {}
        channelMap[row.product_id][row.channel] = { display_name: row.display_name, is_visible: row.is_visible }
      })
      setChannelConfig(channelMap)
      setProducts(productData ?? [])
    })
  }, [])

  // Every item offered on the selected channel, with its channel display
  // name and listed (channel default) price applied. Starts fully in the
  // quotation — cross an item out to leave it off before saving.
  const channelProducts = products
    .filter((p) => !p.supplier_only && channelConfig[p.id]?.[channel]?.is_visible !== false)
    .map((p) => ({
      ...p,
      channelName: channelConfig[p.id]?.[channel]?.display_name || p.name,
      listedPrice: (channel === 'Restaurant' ? p.restaurant_price : p.counter_price) ?? p.default_selling_price,
    }))

  // Reset removals/special prices whenever the channel (or its item set) changes.
  useEffect(() => {
    setRemovedIds(new Set())
    setSpecialPrices({})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel])

  const gridRows = channelProducts.filter((p) => !removedIds.has(p.id))

  function removeItem(productId) {
    setRemovedIds((prev) => new Set(prev).add(productId))
  }

  function resetList() {
    setRemovedIds(new Set())
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    if (!customerName.trim()) {
      setError('Enter the customer name.')
      return
    }
    if (gridRows.length === 0) {
      setError('At least one item must remain in the quotation.')
      return
    }

    setSaving(true)

    const { data: quotation, error: quoError } = await supabase
      .from('quotations')
      .insert({
        date,
        channel,
        customer_name: customerName,
        customer_address: customerAddress || null,
        customer_contact: customerContact || null,
        sent_by_name: sentByName || null,
        sent_by_contact: sentByContact || null,
      })
      .select()
      .single()

    if (quoError) {
      setSaving(false)
      setError(quoError.message)
      return
    }

    const itemRows = gridRows.map((p) => ({
      quotation_id: quotation.id,
      product_id: p.id,
      display_name: p.channelName,
      unit: p.sales_unit || null,
      listed_price: p.listedPrice ?? null,
      special_price: specialPrices[p.id] ? Number(specialPrices[p.id]) : null,
    }))

    const { error: itemsError } = await supabase.from('quotation_items').insert(itemRows)

    setSaving(false)
    if (itemsError) {
      setError(`Quotation saved, but line items failed: ${itemsError.message}`)
      return
    }

    setSavedQuotationId(quotation.id)
  }

  function startNewQuotation() {
    setSavedQuotationId(null)
    setCustomerName('')
    setCustomerAddress('')
    setCustomerContact('')
    setSentByName('')
    setSentByContact('')
    setRemovedIds(new Set())
    setSpecialPrices({})
  }

  if (savedQuotationId) {
    return (
      <div>
        <div className="card no-print">
          <p style={{ color: 'var(--success)' }}>Quotation saved successfully.</p>
          <button className="btn" onClick={startNewQuotation}>
            + New Quotation
          </button>
        </div>
        <QuotationView quotationId={savedQuotationId} />
      </div>
    )
  }

  return (
    <div className="card">
      <h3>New Quotation</h3>
      <div className="form-grid">
        <label>
          Channel
          <select value={channel} onChange={(e) => setChannel(e.target.value)}>
            <option>Restaurant</option>
            <option>Home Delivery</option>
            <option>Counter</option>
          </select>
        </label>
        <label>
          Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <label>
          Customer Name
          <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} required />
        </label>
        <label>
          Customer Address
          <textarea rows={2} value={customerAddress} onChange={(e) => setCustomerAddress(e.target.value)} />
        </label>
        <label>
          Customer Contact
          <input value={customerContact} onChange={(e) => setCustomerContact(e.target.value)} />
        </label>
        <label>
          Quotation Sent By
          <input value={sentByName} onChange={(e) => setSentByName(e.target.value)} placeholder="Staff name" />
        </label>
        <label>
          Sender Contact Number
          <input value={sentByContact} onChange={(e) => setSentByContact(e.target.value)} />
        </label>
      </div>

      <div className="toolbar" style={{ marginTop: '1.25rem' }}>
        <p className="muted" style={{ fontSize: '0.85rem', margin: 0 }}>
          Every item offered on this channel is included by default — click ✕ to leave one out. Leave Special
          Price blank to quote the Listed Price.
        </p>
        {removedIds.size > 0 && (
          <button type="button" className="btn-secondary" onClick={resetList}>
            Reset List ({removedIds.size} removed)
          </button>
        )}
      </div>

      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Unit</th>
              <th>Listed Price</th>
              <th>Special Price</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {gridRows.map((p) => (
              <tr key={p.id}>
                <td>{p.channelName}</td>
                <td>{p.sales_unit || '—'}</td>
                <td>{p.listedPrice != null ? formatMoney(p.listedPrice) : '—'}</td>
                <td>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    style={{ width: 100 }}
                    placeholder={p.listedPrice != null ? String(p.listedPrice) : ''}
                    value={specialPrices[p.id] ?? ''}
                    onChange={(e) => setSpecialPrices({ ...specialPrices, [p.id]: e.target.value })}
                  />
                </td>
                <td>
                  <button type="button" className="btn-secondary" onClick={() => removeItem(p.id)}>
                    ✕
                  </button>
                </td>
              </tr>
            ))}
            {gridRows.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  No items left — Reset List to bring them back.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <button className="btn" style={{ marginTop: '1rem' }} onClick={handleSubmit} disabled={saving}>
        {saving ? 'Saving…' : 'Save Quotation'}
      </button>

      {error && <div className="inline-error">{error}</div>}
    </div>
  )
}
