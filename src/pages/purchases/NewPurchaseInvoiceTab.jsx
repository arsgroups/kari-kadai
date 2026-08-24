import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { fetchRateHistory, buildRateResolver, round2 } from '../../lib/gst'
import { toISODate, formatMoney } from '../../lib/format'
import SearchableSelect from '../../components/SearchableSelect'

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

export default function NewPurchaseInvoiceTab() {
  const [suppliers, setSuppliers] = useState([])
  const [supplierOutstanding, setSupplierOutstanding] = useState({}) // supplier_id -> outstanding
  const [products, setProducts] = useState([])
  const [getRate, setGetRate] = useState(() => () => 9)
  const [supplierId, setSupplierId] = useState('')
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [date, setDate] = useState(toISODate())
  const [paymentType, setPaymentType] = useState('Credit')
  const [note, setNote] = useState('')
  const [lines, setLines] = useState([emptyLine()])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [lastPurchasePrices, setLastPurchasePrices] = useState({}) // product_id -> { rate } | null

  useEffect(() => {
    supabase
      .from('suppliers')
      .select('id, name, gst_registered')
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => setSuppliers(data ?? []))
    supabase
      .from('v_supplier_outstanding')
      .select('supplier_id, outstanding')
      .then(({ data }) => {
        const map = {}
        ;(data ?? []).forEach((row) => {
          map[row.supplier_id] = row.outstanding
        })
        setSupplierOutstanding(map)
      })
    supabase
      .from('products')
      .select('id, name, purchase_unit, default_purchase_price')
      .eq('is_active', true)
      .eq('supplier_only', true)
      .order('name')
      .then(({ data }) => setProducts(data ?? []))
    fetchRateHistory().then((rates) => setGetRate(() => buildRateResolver(rates)))
  }, [])

  const supplier = suppliers.find((s) => s.id === supplierId)
  const rate = getRate(date)

  function updateLine(key, patch) {
    setLines(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }

  async function handleProductChange(key, productId) {
    const product = products.find((p) => p.id === productId)
    updateLine(key, {
      product_id: productId,
      unit: product?.purchase_unit ?? '',
      rate: product?.default_purchase_price ?? '',
      gst_applicable: supplier ? supplier.gst_registered : true,
    })
    if (productId && !(productId in lastPurchasePrices)) {
      const { data } = await supabase
        .from('purchase_invoice_items')
        .select('rate, purchase_invoices!inner(date)')
        .eq('product_id', productId)
        .order('date', { foreignTable: 'purchase_invoices', ascending: false })
        .limit(1)
      setLastPurchasePrices((prev) => ({ ...prev, [productId]: data?.[0] ?? null }))
    }
  }

  // Warns (but never blocks) if the rate just typed in is higher than the
  // last time this item was purchased — cashier clicks OK and carries on.
  function checkPriceIncrease(line) {
    const last = lastPurchasePrices[line.product_id]
    const newRate = Number(line.rate)
    if (last && newRate > Number(last.rate)) {
      window.alert(
        `Price increased: last purchased at ${formatMoney(last.rate)}, now entering ${formatMoney(newRate)}.`
      )
    }
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

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSuccess('')

    const validLines = lines.filter((l) => l.product_id && Number(l.quantity) > 0)
    if (!supplierId || validLines.length === 0) {
      setError('Select a supplier and at least one item line with a quantity.')
      return
    }

    setSaving(true)

    const { data: invoice, error: invoiceError } = await supabase
      .from('purchase_invoices')
      .insert({
        invoice_number: invoiceNumber || null,
        supplier_id: supplierId,
        date,
        payment_type: paymentType,
        subtotal,
        gst_amount: gstTotal,
        source: 'manual',
        note: note || null,
      })
      .select()
      .single()

    if (invoiceError) {
      setSaving(false)
      setError(invoiceError.message)
      return
    }

    const itemRows = validLines.map((l) => ({
      purchase_invoice_id: invoice.id,
      product_id: l.product_id,
      quantity: Number(l.quantity),
      unit: l.unit || null,
      rate: Number(l.rate) || 0,
      discount: Number(l.discount) || 0,
      gst_applicable: l.gst_applicable,
      gst_amount: lineGst(l),
    }))

    const { error: itemsError } = await supabase.from('purchase_invoice_items').insert(itemRows)

    setSaving(false)
    if (itemsError) {
      setError(`Invoice saved, but line items failed: ${itemsError.message}`)
      return
    }

    setSuccess(`Purchase Invoice ${invoice.invoice_number} recorded — total ${formatMoney(grandTotal)}`)
    setInvoiceNumber('')
    setNote('')
    setLines([emptyLine()])
  }

  return (
    <div className="card">
      <h3>New Purchase Invoice</h3>
      <div className="form-grid">
        <label>
          Supplier
          <SearchableSelect
            value={supplierId}
            onChange={setSupplierId}
            placeholder="Select supplier…"
            options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
          />
        </label>
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
          <select value={paymentType} onChange={(e) => setPaymentType(e.target.value)}>
            <option>Cash</option>
            <option>Bank</option>
            <option>Credit</option>
          </select>
        </label>
      </div>

      {supplierId && (
        <p className="muted" style={{ fontSize: '0.85rem' }}>
          {(() => {
            const owed = supplierOutstanding[supplierId] ?? 0
            if (owed > 0) return `Currently owed to this supplier: ${formatMoney(owed)} — any payments already recorded are already netted out of this figure.`
            if (owed < 0) return `This supplier has a credit balance of ${formatMoney(Math.abs(owed))} from prior overpayment — it will automatically reduce what shows as owed once this purchase is added.`
            return 'No outstanding balance with this supplier.'
          })()}
        </p>
      )}

      <table className="data-table" style={{ marginTop: '1.25rem' }}>
        <thead>
          <tr>
            <th>Item</th>
            <th>Qty</th>
            <th>Unit</th>
            <th>Rate</th>
            <th>Discount</th>
            <th>GST?</th>
            <th>GST Amt</th>
            <th>Amount</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.key}>
              <td>
                <SearchableSelect
                  value={line.product_id}
                  onChange={(id) => handleProductChange(line.key, id)}
                  placeholder="Select item…"
                  options={products.map((p) => ({ value: p.id, label: p.name }))}
                />
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
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  style={{ width: 90 }}
                  value={line.rate}
                  onChange={(e) => updateLine(line.key, { rate: e.target.value })}
                  onBlur={() => checkPriceIncrease(line)}
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
              <td>{formatMoney(lineAmount(line))}</td>
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

      <label style={{ display: 'block', marginTop: '1rem', maxWidth: 400 }}>
        Note
        <input value={note} onChange={(e) => setNote(e.target.value)} />
      </label>

      <button className="btn" style={{ marginTop: '1rem' }} onClick={handleSubmit} disabled={saving}>
        {saving ? 'Saving…' : 'Save Purchase Invoice'}
      </button>

      {error && <div className="inline-error">{error}</div>}
      {success && <div style={{ color: 'var(--success)', marginTop: '0.5rem' }}>{success}</div>}
    </div>
  )
}
