import { useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { fetchRateHistory, buildRateResolver, round2, roundSurcharge } from '../../lib/gst'
import { formatDate, formatMoney, toISODate } from '../../lib/format'

export default function NewSalesReturnTab() {
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [invoice, setInvoice] = useState(null)
  const [items, setItems] = useState([])
  const [returnedByItem, setReturnedByItem] = useState({}) // sale_invoice_item_id -> qty already returned
  const [returnQty, setReturnQty] = useState({}) // sale_invoice_item_id -> qty (string)
  const [reason, setReason] = useState('')
  const [finding, setFinding] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function handleFind(e) {
    e.preventDefault()
    setError('')
    setSuccess('')
    setInvoice(null)
    setItems([])
    setReturnQty({})
    if (!invoiceNumber.trim()) return

    setFinding(true)
    const { data: inv, error: invError } = await supabase
      .from('sale_invoices')
      .select(
        'id, invoice_number, date, channel, customer_id, subtotal, gst_amount, total, surcharge_applicable, customers(name)'
      )
      .eq('invoice_number', invoiceNumber.trim())
      .single()

    if (invError || !inv) {
      setFinding(false)
      setError('Invoice not found.')
      return
    }

    const { data: itemRows } = await supabase
      .from('sale_invoice_items')
      .select('id, product_id, quantity, unit, rate, display_name, products(name)')
      .eq('sale_invoice_id', inv.id)

    const itemIds = (itemRows ?? []).map((i) => i.id)
    let returnedMap = {}
    if (itemIds.length) {
      const { data: returnRows } = await supabase
        .from('sale_return_items')
        .select('sale_invoice_item_id, quantity')
        .in('sale_invoice_item_id', itemIds)
      ;(returnRows ?? []).forEach((r) => {
        returnedMap[r.sale_invoice_item_id] = (returnedMap[r.sale_invoice_item_id] ?? 0) + Number(r.quantity)
      })
    }

    setInvoice(inv)
    setItems(itemRows ?? [])
    setReturnedByItem(returnedMap)
    setFinding(false)
  }

  function returnableFor(item) {
    return round2(Number(item.quantity) - (returnedByItem[item.id] ?? 0))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSuccess('')

    const linesToReturn = items
      .map((item) => ({ item, qty: Number(returnQty[item.id]) || 0 }))
      .filter((l) => l.qty > 0)

    if (linesToReturn.length === 0) {
      setError('Enter a return quantity for at least one item.')
      return
    }
    for (const { item, qty } of linesToReturn) {
      if (qty > returnableFor(item)) {
        setError(`Return quantity for "${item.display_name || item.products?.name}" exceeds what's returnable.`)
        return
      }
    }

    setSaving(true)

    const totalReturnAmount = round2(linesToReturn.reduce((sum, l) => sum + l.qty * Number(l.item.rate), 0))

    const { data: saleReturn, error: returnError } = await supabase
      .from('sale_returns')
      .insert({
        sale_invoice_id: invoice.id,
        date: toISODate(),
        reason: reason || null,
        subtotal: totalReturnAmount,
        gst_amount: 0,
      })
      .select()
      .single()

    if (returnError) {
      setSaving(false)
      setError(returnError.message)
      return
    }

    const itemRows = linesToReturn.map(({ item, qty }) => ({
      sale_return_id: saleReturn.id,
      sale_invoice_item_id: item.id,
      product_id: item.product_id,
      quantity: qty,
      unit: item.unit,
      rate: Number(item.rate),
      gst_applicable: false,
      gst_amount: 0,
    }))

    const { error: itemsError } = await supabase.from('sale_return_items').insert(itemRows)
    if (itemsError) {
      setSaving(false)
      setError(`Return saved, but line items failed: ${itemsError.message}`)
      return
    }

    // Recompute the parent invoice's subtotal/gst_amount on the net (post-
    // return) amount -- Restaurant re-derives its flat surcharge the same
    // way it's computed at Sale entry; other channels stay at 0.
    const newSubtotal = round2(Number(invoice.subtotal) - totalReturnAmount)
    let newGstAmount = 0
    if (invoice.channel === 'Restaurant' && invoice.surcharge_applicable) {
      const rates = await fetchRateHistory()
      const rate = buildRateResolver(rates)(invoice.date)
      newGstAmount = roundSurcharge(newSubtotal * (rate / 100))
    }

    const { error: updateError } = await supabase
      .from('sale_invoices')
      .update({ subtotal: newSubtotal, gst_amount: newGstAmount })
      .eq('id', invoice.id)

    setSaving(false)
    if (updateError) {
      setError(`Return saved, but updating the invoice total failed: ${updateError.message}`)
      return
    }

    setSuccess(`Sales Return ${saleReturn.return_number} recorded for ${formatMoney(totalReturnAmount)}.`)
    setInvoiceNumber('')
    setInvoice(null)
    setItems([])
    setReturnQty({})
    setReason('')
  }

  return (
    <div className="card">
      <h3>New Sales Return</h3>
      <form className="form-grid" onSubmit={handleFind} style={{ alignItems: 'end' }}>
        <label>
          Invoice Number
          <input
            value={invoiceNumber}
            onChange={(e) => setInvoiceNumber(e.target.value)}
            placeholder="e.g. INV-00042"
            required
          />
        </label>
        <button className="btn" type="submit" disabled={finding}>
          {finding ? 'Finding…' : 'Find Invoice'}
        </button>
      </form>

      {error && <div className="inline-error">{error}</div>}
      {success && <div style={{ color: 'var(--success)', marginTop: '0.5rem' }}>{success}</div>}

      {invoice && (
        <div style={{ marginTop: '1.25rem' }}>
          <p className="muted">
            {invoice.invoice_number} — {formatDate(invoice.date)} — {invoice.channel} —{' '}
            {invoice.customers?.name ?? 'Counter Sale'}
          </p>

          <table className="data-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Sold Qty</th>
                <th>Already Returned</th>
                <th>Returnable</th>
                <th>Rate</th>
                <th>Return Qty</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const returnable = returnableFor(item)
                return (
                  <tr key={item.id}>
                    <td>{item.display_name || item.products?.name || '—'}</td>
                    <td>
                      {item.quantity} {item.unit}
                    </td>
                    <td>{returnedByItem[item.id] ?? 0}</td>
                    <td>{returnable}</td>
                    <td>{formatMoney(item.rate)}</td>
                    <td>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        max={returnable}
                        style={{ width: 90 }}
                        disabled={returnable <= 0}
                        value={returnQty[item.id] ?? ''}
                        onChange={(e) => setReturnQty({ ...returnQty, [item.id]: e.target.value })}
                      />
                    </td>
                  </tr>
                )
              })}
              {items.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    No items on this invoice.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <label style={{ display: 'block', marginTop: '1rem', maxWidth: 400 }}>
            Reason
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Optional" />
          </label>

          <button className="btn" style={{ marginTop: '1rem' }} onClick={handleSubmit} disabled={saving}>
            {saving ? 'Saving…' : 'Save Sales Return'}
          </button>
        </div>
      )}
    </div>
  )
}
