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
    promoFreeFor: null,
  }
}

export default function NewSaleInvoiceTab() {
  const [customers, setCustomers] = useState([])
  const [products, setProducts] = useState([])
  const [channelConfig, setChannelConfig] = useState({}) // product_id -> { [channel]: { display_name, is_visible } }
  const [getRate, setGetRate] = useState(() => () => 9)
  const [customerPrices, setCustomerPrices] = useState({}) // product_id -> price
  const [promotions, setPromotions] = useState([])
  const [promoBuyProducts, setPromoBuyProducts] = useState({}) // promotion_id -> [product_id, ...]

  const [channel, setChannel] = useState('Counter')
  const [customerId, setCustomerId] = useState('')
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [date, setDate] = useState(toISODate())
  const [paymentType, setPaymentType] = useState('Cash')
  const [dueDate, setDueDate] = useState('')
  const [dueDateTouched, setDueDateTouched] = useState(false)
  const [paidAmount, setPaidAmount] = useState('')
  const [paidAmountTouched, setPaidAmountTouched] = useState(false)
  const [remarks, setRemarks] = useState('')
  const [applySurcharge, setApplySurcharge] = useState(true) // Restaurant only, defaults from the customer's profile
  const [lines, setLines] = useState([emptyLine()])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [savedInvoiceId, setSavedInvoiceId] = useState(null)

  useEffect(() => {
    supabase
      .from('customers')
      .select('id, name, type, credit_days, surcharge_applicable')
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => setCustomers(data ?? []))
    Promise.all([
      supabase
        .from('products')
        .select(
          'id, name, unit, sales_unit, default_selling_price, restaurant_price, counter_price, supplier_only, average_cost, default_purchase_price'
        )
        .eq('is_active', true)
        .order('name'),
      supabase.from('v_current_stock').select('product_id, current_stock'),
      supabase
        .from('yield_configuration_items')
        .select('child_product_id, is_active, yield_configurations!inner(parent_product_id, is_active)')
        .eq('is_active', true)
        .eq('yield_configurations.is_active', true),
      supabase.from('product_channel_config').select('product_id, channel, display_name, is_visible'),
      supabase.from('promotions').select('*').eq('is_active', true),
      supabase.from('promotion_products').select('promotion_id, product_id'),
    ]).then(
      ([{ data: productData }, { data: stockData }, { data: yieldData }, { data: channelData }, { data: promoData }, { data: promoBuyRows }]) => {
      setPromotions(promoData ?? [])
      const buyProductsMap = {}
      ;(promoBuyRows ?? []).forEach((row) => {
        if (!buyProductsMap[row.promotion_id]) buyProductsMap[row.promotion_id] = []
        buyProductsMap[row.promotion_id].push(row.product_id)
      })
      setPromoBuyProducts(buyProductsMap)
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
      setApplySurcharge(true)
      return
    }
    setApplySurcharge(customers.find((c) => c.id === customerId)?.surcharge_applicable ?? true)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId])

  // Re-price any lines that already have an item picked when the channel
  // changes, so the cashier doesn't have to re-select each item to see the
  // new channel's price (still editable afterwards on a per-line basis).
  useEffect(() => {
    setLines((prev) =>
      prev.map((l) => {
        if (!l.product_id) return l
        const product = products.find((p) => p.id === l.product_id)
        const customPrice = customerPrices[l.product_id]
        const channelPrice = channel === 'Restaurant' ? product?.restaurant_price : product?.counter_price
        return { ...l, rate: customPrice ?? channelPrice ?? product?.default_selling_price ?? l.rate }
      })
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel])

  // Credit is only offered for customer-based channels (Restaurant / Home
  // Delivery) — default to it there since most of their sales run on
  // credit, and force back to Cash for Counter (no customer to bill).
  useEffect(() => {
    if (channel === 'Counter') {
      if (paymentType === 'Credit') setPaymentType('Cash')
    } else {
      setPaymentType('Credit')
      setPaidAmountTouched(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel])

  // Auto-fill the due date from the customer's credit terms whenever Credit
  // is selected, unless the cashier has already edited it by hand.
  useEffect(() => {
    if (paymentType !== 'Credit') {
      setDueDate('')
      setDueDateTouched(false)
      return
    }
    if (dueDateTouched) return
    const customer = customers.find((c) => c.id === customerId)
    if (customer?.credit_days != null) {
      const d = new Date(date)
      d.setDate(d.getDate() + Number(customer.credit_days))
      setDueDate(toISODate(d))
    } else {
      setDueDate('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentType, customerId, date, customers])

  const requiresCustomer = channel !== 'Counter'
  const filteredCustomers = useMemo(() => customers.filter((c) => c.type === channel), [customers, channel])
  const rate = getRate(date)
  // Not GST-registered: Counter and Home Delivery charge exactly the entered
  // Price, nothing added, single Total. Restaurant still adds a flat 9%
  // surcharge by default, shown as a plain rounded number below the Total
  // (no "Tax"/"GST" wording, no per-line breakout) -- unless the Surcharge
  // checkbox is unticked, defaulted from the customer's profile but
  // overridable per invoice.
  const isRestaurant = channel === 'Restaurant'
  const showSurcharge = isRestaurant && applySurcharge

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

  function activePromo(productId, promoType, forDate) {
    return promotions.find(
      (p) =>
        p.product_id === productId &&
        p.promo_type === promoType &&
        p.is_active &&
        forDate >= p.start_date &&
        forDate <= p.end_date
    )
  }

  function activeBuyPromos(forDate) {
    return promotions.filter(
      (p) => p.promo_type === 'buy_x_get_y' && p.is_active && forDate >= p.start_date && forDate <= p.end_date
    )
  }

  // Recomputes discount-promo amounts, and keeps each active Buy-X-Get-Y
  // deal's single auto-added $0 "free" line in sync with the combined
  // quantity of every paid line across its (possibly mixed) buy items —
  // adding, updating, or removing that line as needed.
  function applyPromotions(inputLines, forDate) {
    let result = inputLines.map((l) => ({ ...l }))

    result = result.map((l) => {
      if (l.promoFreeFor || !l.product_id) return l
      const promo = activePromo(l.product_id, 'discount', forDate)
      if (!promo) return l
      const qty = Number(l.quantity) || 0
      const rateVal = Number(l.rate) || 0
      const discount =
        promo.discount_type === 'percent'
          ? round2(qty * rateVal * (promo.discount_value / 100))
          : round2(qty * promo.discount_value)
      return { ...l, discount }
    })

    for (const promo of activeBuyPromos(forDate)) {
      const eligibleIds = promoBuyProducts[promo.id]?.length ? promoBuyProducts[promo.id] : [promo.product_id]
      const totalQty = result
        .filter((l) => !l.promoFreeFor && eligibleIds.includes(l.product_id))
        .reduce((sum, l) => sum + (Number(l.quantity) || 0), 0)
      const freeQty = promo.buy_qty > 0 ? Math.floor(totalQty / promo.buy_qty) * promo.free_qty : 0
      const existingIdx = result.findIndex((l) => l.promoFreeFor === promo.id)

      if (freeQty <= 0) {
        if (existingIdx !== -1) result.splice(existingIdx, 1)
        continue
      }

      const freeProductId = promo.free_product_id || promo.product_id
      const freeProduct = products.find((p) => p.id === freeProductId)
      const freeLineData = {
        product_id: freeProductId,
        quantity: freeQty,
        unit: freeProduct?.sales_unit ?? '',
        rate: 0,
        discount: 0,
        gst_applicable: false,
        promoFreeFor: promo.id,
      }
      if (existingIdx !== -1) {
        result[existingIdx] = { ...result[existingIdx], ...freeLineData }
      } else {
        result.push({ key: crypto.randomUUID(), ...freeLineData })
      }
    }

    return result
  }

  // Re-sync promotions whenever the invoice date changes, since a promo's
  // active period is checked against this date.
  useEffect(() => {
    setLines((prev) => applyPromotions(prev, date))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, promotions])

  function updateLine(key, patch) {
    setLines((prev) => {
      const next = prev.map((l) => (l.key === key ? { ...l, ...patch } : l))
      return 'quantity' in patch || 'product_id' in patch ? applyPromotions(next, date) : next
    })
  }

  function handleProductChange(key, productId) {
    const product = products.find((p) => p.id === productId)
    const customPrice = customerPrices[productId]
    const channelPrice = channel === 'Restaurant' ? product?.restaurant_price : product?.counter_price
    updateLine(key, {
      product_id: productId,
      unit: product?.sales_unit ?? '',
      rate: customPrice ?? channelPrice ?? product?.default_selling_price ?? '',
      gst_applicable: true,
    })
  }

  function addLine() {
    setLines([...lines, emptyLine()])
  }

  function removeLine(key) {
    setLines((prev) => {
      const target = prev.find((l) => l.key === key)
      const filtered = prev.filter((l) => l.key !== key)
      // Removing a paid line can change (or clear) a mixed-item promo's
      // total, so recompute; removing an auto-added free line manually is
      // left as the cashier's explicit choice, not recomputed back in.
      return target?.promoFreeFor ? filtered : applyPromotions(filtered, date)
    })
  }

  function lineAmount(line) {
    const qty = Number(line.quantity) || 0
    const rateVal = Number(line.rate) || 0
    const discount = Number(line.discount) || 0
    return round2(qty * rateVal - discount)
  }

  // Prefers the actual weighted average cost from purchases; falls back to
  // the item's default purchase price if it's never been bought yet.
  function costFor(productId) {
    const product = products.find((p) => p.id === productId)
    return Number(product?.average_cost) || Number(product?.default_purchase_price) || 0
  }

  // Warns (but never blocks) if the rate just typed in is below cost —
  // cashier clicks OK and can still save the invoice at that price.
  function checkBelowCost(line) {
    const cost = costFor(line.product_id)
    const newRate = Number(line.rate)
    if (cost > 0 && newRate > 0 && newRate < cost) {
      window.alert(`Selling below cost: cost is ${formatMoney(cost)}, selling at ${formatMoney(newRate)}.`)
    }
  }

  const subtotal = round2(lines.reduce((sum, l) => sum + lineAmount(l), 0))
  // Restaurant's 9% is charged only on the invoice total, not per line, and
  // is rounded to a whole number rather than to the cent.
  const gstTotal = showSurcharge ? Math.round(subtotal * (rate / 100)) : 0
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
        due_date: paymentType === 'Credit' && dueDate ? dueDate : null,
        subtotal,
        gst_amount: gstTotal,
        surcharge_applicable: applySurcharge,
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

    const itemRows = validLines.map((l) => {
      const baseName = channelProducts.find((p) => p.id === l.product_id)?.channelName || null
      return {
        sale_invoice_id: invoice.id,
        product_id: l.product_id,
        quantity: Number(l.quantity),
        unit: l.unit || null,
        rate: Number(l.rate) || 0,
        discount: Number(l.discount) || 0,
        gst_applicable: l.gst_applicable,
        gst_amount: 0,
        display_name: l.promoFreeFor ? `${baseName || 'Item'} (Free)` : baseName,
      }
    })

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
    setDueDate('')
    setDueDateTouched(false)
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
            {channel !== 'Counter' && <option>Credit</option>}
          </select>
        </label>
        {paymentType === 'Credit' && (
          <label>
            Due Date
            <input
              type="date"
              value={dueDate}
              onChange={(e) => {
                setDueDate(e.target.value)
                setDueDateTouched(true)
              }}
            />
          </label>
        )}
      </div>

      {customerId && Object.keys(customerPrices).length > 0 && (
        <p className="muted" style={{ fontSize: '0.85rem' }}>
          This customer has custom pricing — it's been loaded automatically for matching items below.
        </p>
      )}

      {isRestaurant && (
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem', marginTop: '0.75rem' }}>
          <input type="checkbox" checked={applySurcharge} onChange={(e) => setApplySurcharge(e.target.checked)} />
          Apply 9% Surcharge
        </label>
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
            <th>Total</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => {
            const isFreeLine = Boolean(line.promoFreeFor)
            const hasDiscountPromo = !isFreeLine && line.product_id && activePromo(line.product_id, 'discount', date)
            return (
            <tr key={line.key} style={isFreeLine ? { background: 'var(--bg)' } : undefined}>
              <td>
                {isFreeLine ? (
                  <span>
                    {channelProducts.find((p) => p.id === line.product_id)?.channelName || 'Item'}{' '}
                    <span className="tag tag-success">FREE — Promo</span>
                  </span>
                ) : (
                  <select value={line.product_id} onChange={(e) => handleProductChange(line.key, e.target.value)}>
                    <option value="">Select item…</option>
                    {channelProducts.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.channelName}
                        {p.cutFrom ? ` (from ${p.cutFrom})` : ''}
                      </option>
                    ))}
                  </select>
                )}
              </td>
              <td>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  style={{ width: 80 }}
                  value={line.quantity}
                  disabled={isFreeLine}
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
                  disabled={isFreeLine}
                  onChange={(e) => updateLine(line.key, { rate: e.target.value })}
                  onBlur={() => !isFreeLine && checkBelowCost(line)}
                />
              </td>
              <td>
                {hasDiscountPromo && (
                  <div className="muted" style={{ fontSize: '0.7rem' }}>
                    Promo
                  </div>
                )}
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  style={{ width: 80 }}
                  value={line.discount}
                  disabled={isFreeLine}
                  onChange={(e) => updateLine(line.key, { discount: e.target.value })}
                />
              </td>
              <td>{formatMoney(lineAmount(line))}</td>
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
        + Add Line
      </button>

      <div className="card" style={{ marginTop: '1.25rem', maxWidth: 320 }}>
        <table className="data-table">
          <tbody>
            <tr style={{ fontWeight: showSurcharge ? 400 : 700 }}>
              <td>Total</td>
              <td>{formatMoney(subtotal)}</td>
            </tr>
            {showSurcharge && (
              <>
                <tr>
                  <td></td>
                  <td>S${gstTotal}</td>
                </tr>
                <tr style={{ fontWeight: 700 }}>
                  <td>Net Total</td>
                  <td>{formatMoney(grandTotal)}</td>
                </tr>
              </>
            )}
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
