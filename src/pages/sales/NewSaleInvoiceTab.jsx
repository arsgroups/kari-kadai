import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { fetchRateHistory, buildRateResolver, round2 } from '../../lib/gst'
import { conversionFactor } from '../../lib/units'
import { toISODate, formatMoney } from '../../lib/format'
import SaleInvoiceView from './SaleInvoiceView'

function emptyLine() {
  return {
    key: crypto.randomUUID(),
    product_id: '',
    quantity: '',
    unit: '',
    rate: '',
    discount: 0,
    gst_applicable: true,
  }
}

export default function NewSaleInvoiceTab() {
  const [customers, setCustomers] = useState([])
  const [products, setProducts] = useState([])
  const [channelConfig, setChannelConfig] = useState({}) // product_id -> { [channel]: { display_name, is_visible } }
  const [getRate, setGetRate] = useState(() => () => 9)
  const [customerPrices, setCustomerPrices] = useState({}) // product_id -> price

  const [channel, setChannel] = useState('Counter')
  const [customerId, setCustomerId] = useState('')
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [date, setDate] = useState(toISODate())
  const [paymentType, setPaymentType] = useState('Cash')
  const [paidAmount, setPaidAmount] = useState('')
  const [paidAmountTouched, setPaidAmountTouched] = useState(false)
  const [remarks, setRemarks] = useState('')
  const [lines, setLines] = useState([emptyLine()])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [savedInvoiceId, setSavedInvoiceId] = useState(null)

  useEffect(() => {
    supabase
      .from('customers')
      .select('id, name, type')
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => setCustomers(data ?? []))
    Promise.all([
      supabase
        .from('products')
        .select('id, name, unit, sales_unit, default_selling_price')
        .eq('is_active', true)
        .order('name'),
      supabase.from('v_current_stock').select('product_id, current_stock'),
      supabase
        .from('yield_configuration_items')
        .select('child_product_id, is_active, yield_configurations!inner(parent_product_id, is_active)')
        .eq('is_active', true)
        .eq('yield_configurations.is_active', true),
      supabase.from('product_channel_config').select('product_id, channel, display_name, is_visible'),
    ]).then(([{ data: productData }, { data: stockData }, { data: yieldData }, { data: channelData }]) => {
      const channelMap = {}
      ;(channelData ?? []).forEach((row) => {
        if (!channelMap[row.product_id]) channelMap[row.product_id] = {}
        channelMap[row.product_id][row.channel] = { display_name: row.display_name, is_visible: row.is_visible }
      })
      setChannelConfig(channelMap)
      const stockByProduct = {}
      ;(stockData ?? []).forEach((s) => {
        stockByProduct[s.product_id] = s.current_stock
      })
      const parentByChild = {}
      ;(yieldData ?? []).forEach((y) => {
        parentByChild[y.child_product_id] = y.yield_configurations.parent_product_id
      })
      const productById = {}
      ;(productData ?? []).forEach((p) => {
        productById[p.id] = p
      })
      setProducts(
        (productData ?? []).map((p) => {
          const parentId = parentByChild[p.id]
          const parent = parentId ? productById[parentId] : null
          // For a configured yield-child, "available" reflects the parent's stock
          // (converted through both products' units) since the child holds none itself.
          const availableInSalesUnit = parent
            ? round2(
                ((stockByProduct[parent.id] ?? 0) * conversionFactor(parent.unit, p.unit)) /
                  conversionFactor(p.sales_unit, p.unit)
              )
            : round2((stockByProduct[p.id] ?? 0) / conversionFactor(p.sales_unit, p.unit))
          return { ...p, availableInSalesUnit, cutFrom: parent?.name ?? null }
        })
      )
    })
    fetchRateHistory().then((rates) => setGetRate(() => buildRateResolver(rates)))
  }, [])

  useEffect(() => {
    if (!customerId) {
      setCustomerPrices({})
      return
    }
    supabase
      .from('customer_item_prices')
      .select('product_id, price')
      .eq('customer_id', customerId)
      .then(({ data }) => {
        const map = {}
        ;(data ?? []).forEach((row) => {
          map[row.product_id] = row.price
        })
        setCustomerPrices(map)
      })
  }, [customerId])

  const requiresCustomer = channel !== 'Counter'
  const filteredCustomers = useMemo(() => customers.filter((c) => c.type === channel), [customers, channel])
  const rate = getRate(date)

  // Products actually offered on the currently selected channel, with any
  // per-channel display name applied (e.g. "Mutton" here, "Fresh Goat/Lamb"
  // elsewhere) — defaults to visible everywhere under its own name.
  const channelProducts = useMemo(
    () =>
      products
        .filter((p) => channelConfig[p.id]?.[channel]?.is_visible !== false)
        .map((p) => ({ ...p, channelName: channelConfig[p.id]?.[channel]?.display_name || p.name })),
    [products, channelConfig, channel]
  )

  function updateLine(key, patch) {
    setLines(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }

  function handleProductChange(key, productId) {
    const product = products.find((p) => p.id === productId)
    const customPrice = customerPrices[productId]
    updateLine(key, {
      product_id: productId,
      unit: product?.sales_unit ?? '',
      rate: customPrice ?? product?.default_selling_price ?? '',
      gst_applicable: true,
    })
  }

  function addLine() {
    setLines([...lines, emptyLine()])
  }

  function removeLine(key) {
    setLines(lines.filter((l) => l.key !== key))
  }

  function lineAmount(line) {
    const qty = Number(line.quantity) || 0
    const rateVal = Number(line.rate) || 0
    const discount = Number(line.discount) || 0
    return round2(qty * rateVal - discount)
  }

  function lineGst(line) {
    return line.gst_applicable ? round2(lineAmount(line) * (rate / 100)) : 0
  }

  const subtotal = round2(lines.reduce((sum, l) => sum + lineAmount(l), 0))
  const gstTotal = round2(lines.reduce((sum, l) => sum + lineGst(l), 0))
  const grandTotal = round2(subtotal + gstTotal)

  const effectivePaid =
    paidAmountTouched || paymentType === 'Credit' ? Number(paidAmount) || 0 : grandTotal
  const balance = round2(grandTotal - effectivePaid)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    const validLines = lines.filter((l) => l.product_id && Number(l.quantity) > 0)
    if (requiresCustomer && !customerId) {
      setError('Please select a customer for Restaurant / Home Delivery sales.')
      return
    }
    if (validLines.length === 0) {
      setError('Add at least one item line with a quantity.')
      return
    }

    setSaving(true)

    const { data: invoice, error: invoiceError } = await supabase
      .from('sale_invoices')
      .insert({
        invoice_number: invoiceNumber || null,
        date,
        customer_id: requiresCustomer ? customerId : null,
        channel,
        payment_type: paymentType,
        subtotal,
        gst_amount: gstTotal,
        paid_amount: effectivePaid,
        remarks: remarks || null,
      })
      .select()
      .single()

    if (invoiceError) {
      setSaving(false)
      setError(invoiceError.message)
      return
    }

    const itemRows = validLines.map((l) => ({
      sale_invoice_id: invoice.id,
      product_id: l.product_id,
      quantity: Number(l.quantity),
      unit: l.unit || null,
      rate: Number(l.rate) || 0,
      discount: Number(l.discount) || 0,
      gst_applicable: l.gst_applicable,
      gst_amount: lineGst(l),
      display_name: channelProducts.find((p) => p.id === l.product_id)?.channelName || null,
    }))

    const { error: itemsError } = await supabase.from('sale_invoice_items').insert(itemRows)

    setSaving(false)
    if (itemsError) {
      setError(`Invoice saved, but line items failed: ${itemsError.message}`)
      return
    }

    setSavedInvoiceId(invoice.id)
  }

  function startNewInvoice() {
    setSavedInvoiceId(null)
    setInvoiceNumber('')
    setPaidAmount('')
    setPaidAmountTouched(false)
    setRemarks('')
    setLines([emptyLine()])
  }

  if (savedInvoiceId) {
    return (
      <div>
        <div className="card no-print">
          <p style={{ color: 'var(--success)' }}>Invoice saved successfully.</p>
          <button className="btn" onClick={startNewInvoice}>
            + New Invoice
          </button>
        </div>
        <SaleInvoiceView invoiceId={savedInvoiceId} />
      </div>
    )
  }

  return (
    <div className="card">
      <h3>New Sale Invoice</h3>
      <div className="form-grid">
        <label>
          Channel
          <select
            value={channel}
            onChange={(e) => {
              setChannel(e.target.value)
              setCustomerId('')
            }}
          >
            <option>Counter</option>
            <option>Restaurant</option>
            <option>Home Delivery</option>
          </select>
        </label>
        {requiresCustomer && (
          <label>
            Customer
            <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} required>
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
          Invoice Number
          <input
            value={invoiceNumber}
            onChange={(e) => setInvoiceNumber(e.target.value)}
            placeholder="Leave blank to auto-generate"
          />
        </label>
        <label>
          Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <label>
          Payment Type
          <select
            value={paymentType}
            onChange={(e) => {
              setPaymentType(e.target.value)
              setPaidAmountTouched(false)
            }}
          >
            <option>Cash</option>
            <option>Bank</option>
            <option>Credit</option>
          </select>
        </label>
      </div>

      {customerId && Object.keys(customerPrices).length > 0 && (
        <p className="muted" style={{ fontSize: '0.85rem' }}>
          This customer has custom pricing — it's been loaded automatically for matching items below.
        </p>
      )}

      <table className="data-table" style={{ marginTop: '1.25rem' }}>
        <thead>
          <tr>
            <th>Item</th>
            <th>Qty</th>
            <th>Unit</th>
            <th>Available</th>
            <th>Price</th>
            <th>Discount</th>
            <th>GST?</th>
            <th>GST Amt</th>
            <th>Total</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.key}>
              <td>
                <select value={line.product_id} onChange={(e) => handleProductChange(line.key, e.target.value)}>
                  <option value="">Select item…</option>
                  {channelProducts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.channelName}
                      {p.cutFrom ? ` (from ${p.cutFrom})` : ''}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  style={{ width: 80 }}
                  value={line.quantity}
                  onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                />
              </td>
              <td>{line.unit || '—'}</td>
              <td>
                {(() => {
                  const product = products.find((p) => p.id === line.product_id)
                  if (!product) return '—'
                  const short = Number(line.quantity) > product.availableInSalesUnit
                  return (
                    <span className={short ? 'tag tag-danger' : 'tag tag-muted'}>
                      {product.availableInSalesUnit} {product.sales_unit}
                    </span>
                  )
                })()}
              </td>
              <td>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  style={{ width: 90 }}
                  value={line.rate}
                  onChange={(e) => updateLine(line.key, { rate: e.target.value })}
                />
              </td>
              <td>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  style={{ width: 80 }}
                  value={line.discount}
                  onChange={(e) => updateLine(line.key, { discount: e.target.value })}
                />
              </td>
              <td>
                <input
                  type="checkbox"
                  checked={line.gst_applicable}
                  onChange={(e) => updateLine(line.key, { gst_applicable: e.target.checked })}
                />
              </td>
              <td>{formatMoney(lineGst(line))}</td>
              <td>{formatMoney(lineAmount(line) + lineGst(line))}</td>
              <td>
                <button type="button" className="btn-secondary" onClick={() => removeLine(line.key)}>
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="btn-secondary" style={{ marginTop: '0.75rem' }} onClick={addLine}>
        + Add Line
      </button>

      <div className="card" style={{ marginTop: '1.25rem', maxWidth: 320 }}>
        <table className="data-table">
          <tbody>
            <tr>
              <td>Subtotal</td>
              <td>{formatMoney(subtotal)}</td>
            </tr>
            <tr>
              <td>GST ({rate}%)</td>
              <td>{formatMoney(gstTotal)}</td>
            </tr>
            <tr style={{ fontWeight: 700 }}>
              <td>Grand Total</td>
              <td>{formatMoney(grandTotal)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="form-grid" style={{ marginTop: '1rem' }}>
        <label>
          Paid Amount
          <input
            type="number"
            step="0.01"
            value={paidAmountTouched || paymentType === 'Credit' ? paidAmount : grandTotal}
            onChange={(e) => {
              setPaidAmountTouched(true)
              setPaidAmount(e.target.value)
            }}
          />
        </label>
        <label>
          Balance
          <input value={formatMoney(balance)} disabled />
        </label>
        <label>
          Remarks
          <input value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </label>
      </div>

      <button className="btn" style={{ marginTop: '1rem' }} onClick={handleSubmit} disabled={saving}>
        {saving ? 'Saving…' : 'Save Invoice'}
      </button>

      {error && <div className="inline-error">{error}</div>}
    </div>
  )
}
