import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { toISODate, formatMoney } from '../../lib/format'
import QuotationView from './QuotationView'

function emptyLine() {
  return { key: crypto.randomUUID(), product_id: '', listed_price: '', special_price: '' }
}

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
  const [lines, setLines] = useState([emptyLine()])
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

  // Items actually offered on the selected channel, with their channel
  // display name and listed (channel default) price applied.
  const channelProducts = products
    .filter((p) => !p.supplier_only && channelConfig[p.id]?.[channel]?.is_visible !== false)
    .map((p) => ({
      ...p,
      channelName: channelConfig[p.id]?.[channel]?.display_name || p.name,
      listedPrice: (channel === 'Restaurant' ? p.restaurant_price : p.counter_price) ?? p.default_selling_price,
    }))

  function updateLine(key, patch) {
    setLines(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }

  function handleProductChange(key, productId) {
    const product = channelProducts.find((p) => p.id === productId)
    updateLine(key, { product_id: productId, listed_price: product?.listedPrice ?? '' })
  }

  function addLine() {
    setLines([...lines, emptyLine()])
  }

  function removeLine(key) {
    setLines(lines.filter((l) => l.key !== key))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    const validLines = lines.filter((l) => l.product_id)
    if (!customerName.trim()) {
      setError('Enter the customer name.')
      return
    }
    if (validLines.length === 0) {
      setError('Add at least one item.')
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

    const itemRows = validLines.map((l) => {
      const product = channelProducts.find((p) => p.id === l.product_id)
      return {
        quotation_id: quotation.id,
        product_id: l.product_id,
        display_name: product?.channelName || 'Item',
        unit: product?.sales_unit || null,
        listed_price: l.listed_price === '' ? null : Number(l.listed_price),
        special_price: l.special_price === '' ? null : Number(l.special_price),
      }
    })

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
    setLines([emptyLine()])
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
          <select
            value={channel}
            onChange={(e) => {
              setChannel(e.target.value)
              setLines([emptyLine()])
            }}
          >
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

      <table className="data-table" style={{ marginTop: '1.25rem' }}>
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
          {lines.map((line) => {
            const product = channelProducts.find((p) => p.id === line.product_id)
            return (
              <tr key={line.key}>
                <td>
                  <select value={line.product_id} onChange={(e) => handleProductChange(line.key, e.target.value)}>
                    <option value="">Select item…</option>
                    {channelProducts.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.channelName}
                      </option>
                    ))}
                  </select>
                </td>
                <td>{product?.sales_unit || '—'}</td>
                <td>{line.listed_price !== '' ? formatMoney(line.listed_price) : '—'}</td>
                <td>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    style={{ width: 100 }}
                    placeholder={line.listed_price !== '' ? String(line.listed_price) : ''}
                    value={line.special_price}
                    onChange={(e) => updateLine(line.key, { special_price: e.target.value })}
                  />
                </td>
                <td>
                  <button type="button" className="btn-secondary" onClick={() => removeLine(line.key)}>
                    ✕
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <button type="button" className="btn-secondary" style={{ marginTop: '0.75rem' }} onClick={addLine}>
        + Add Item
      </button>

      <p className="muted" style={{ fontSize: '0.8rem', marginTop: '0.75rem' }}>
        Leave Special Price blank to quote the Listed Price.
      </p>

      <button className="btn" style={{ marginTop: '1rem' }} onClick={handleSubmit} disabled={saving}>
        {saving ? 'Saving…' : 'Save Quotation'}
      </button>

      {error && <div className="inline-error">{error}</div>}
    </div>
  )
}
