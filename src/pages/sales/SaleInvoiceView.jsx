import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { formatDate, formatMoney } from '../../lib/format'
import { fetchRateHistory, buildRateResolver, round2, roundSurcharge } from '../../lib/gst'
import { COMPANY } from '../../lib/companyInfo'
import invoiceHeaderImg from '../../assets/invoice-header.jpg'
import { useAuth } from '../../contexts/AuthContext'

// Fetches an image (bundled asset or a configured Storage URL) and resolves
// its PDF-ready data URL along with format + natural size, so a custom
// upload of any aspect ratio still renders at the correct proportions.
// Mirrors unit_conversion_factor() in schema.sql (Kg<->Gram).
function unitConversionFactor(fromUnit, toUnit) {
  if (fromUnit === toUnit) return 1
  if (fromUnit === 'Kg' && toUnit === 'Gram') return 1000
  if (fromUnit === 'Gram' && toUnit === 'Kg') return 0.001
  return 1
}

function loadImageInfo(url) {
  return fetch(url)
    .then((res) => res.blob())
    .then(
      (blob) =>
        new Promise((resolve, reject) => {
          const reader = new FileReader()
          reader.onloadend = () => {
            const dataUrl = reader.result
            const img = new Image()
            img.onload = () =>
              resolve({
                dataUrl,
                format: blob.type.includes('png') ? 'PNG' : 'JPEG',
                width: img.naturalWidth,
                height: img.naturalHeight,
              })
            img.onerror = reject
            img.src = dataUrl
          }
          reader.onerror = reject
          reader.readAsDataURL(blob)
        })
    )
}

export default function SaleInvoiceView({ invoiceId, onClose, onDeleted }) {
  const { isAdmin } = useAuth()
  const [invoice, setInvoice] = useState(null)
  const [items, setItems] = useState([])
  const [branding, setBranding] = useState(null)
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [editing, setEditing] = useState(false)
  const [editLines, setEditLines] = useState([])
  const [editProducts, setEditProducts] = useState([]) // channel-visible products, for the Add Line picker
  const [newLineProduct, setNewLineProduct] = useState('')
  const [stockMeta, setStockMeta] = useState({}) // product_id -> { unit, factor, parentId, parentUnit }
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState('')

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceId])

  async function load() {
    setLoading(true)
    const [{ data: inv }, { data: itemRows }, { data: brandingRow }] = await Promise.all([
      supabase
        .from('sale_invoices')
        .select('*, customers(name, address, contact)')
        .eq('id', invoiceId)
        .single(),
      supabase
        .from('sale_invoice_items')
        .select('*, products(name)')
        .eq('sale_invoice_id', invoiceId),
      supabase.from('branding_settings').select('header_image_url, footer_image_url').single(),
    ])
    setInvoice(inv)
    setItems(itemRows ?? [])
    setBranding(brandingRow)
    setLoading(false)
  }

  const headerImageUrl = branding?.header_image_url || invoiceHeaderImg
  const footerImageUrl = branding?.footer_image_url || null
  const isRestaurant = invoice?.channel === 'Restaurant'
  const showSurcharge = isRestaurant && Number(invoice?.gst_amount) > 0

  async function buildPdf() {
    if (!invoice) return null
    const showDiscount = items.some((it) => Number(it.discount) > 0)
    const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
      import('jspdf'),
      import('jspdf-autotable'),
    ])
    const doc = new jsPDF()

    // Fit the header to the usable A4 width (210mm - 2*14mm margin), at
    // whatever aspect ratio the configured (or default) image actually has.
    const bannerWidth = 182
    const headerInfo = await loadImageInfo(headerImageUrl)
    const bannerHeight = bannerWidth / (headerInfo.width / headerInfo.height)
    doc.addImage(headerInfo.dataUrl, headerInfo.format, 14, 10, bannerWidth, bannerHeight)

    const metaY = 10 + bannerHeight + 8
    doc.setFontSize(8)
    doc.text('Bill To:', 14, metaY)
    doc.setFontSize(10)
    doc.text(invoice.customers?.name ?? 'Counter Sale', 14, metaY + 4)
    const addressLines = invoice.customers?.address ? invoice.customers.address.split('\n').filter(Boolean) : []
    doc.setFontSize(9)
    if (addressLines.length) doc.text(addressLines, 14, metaY + 9)
    const addressExtra = Math.max(addressLines.length - 1, 0) * 5
    if (invoice.customers?.contact) doc.text(invoice.customers.contact, 14, metaY + 9 + addressExtra + 4)

    doc.setFontSize(14)
    doc.text('INVOICE', 150, metaY - 4)
    doc.setFontSize(10)
    doc.text(`Invoice No: ${invoice.invoice_number}`, 150, metaY + 3)
    doc.text(`Date: ${formatDate(invoice.date)}`, 150, metaY + 8)
    doc.text(`Payment: ${invoice.payment_type}`, 150, metaY + 13)
    if (invoice.payment_type === 'Credit' && invoice.due_date) {
      doc.text(`Due: ${formatDate(invoice.due_date)}`, 150, metaY + 18)
    }

    // Exactly 14 items per page, not however many happen to fit -- once a
    // page's items are done, the next page starts fresh with a "continued"
    // heading and its own S.No continuing from where the last page left off.
    const ITEMS_PER_PAGE = 14
    const itemPages = []
    for (let i = 0; i < items.length; i += ITEMS_PER_PAGE) {
      itemPages.push(items.slice(i, i + ITEMS_PER_PAGE))
    }
    if (itemPages.length === 0) itemPages.push([])

    let serial = 0
    itemPages.forEach((pageItems, pageIndex) => {
      let tableStartY = metaY + 23 + addressExtra
      if (pageIndex > 0) {
        doc.addPage()
        doc.setFontSize(11)
        doc.text(`Invoice No: ${invoice.invoice_number} (continued) — Page ${pageIndex + 1}`, 14, 20)
        tableStartY = 28
      }
      autoTable(doc, {
        startY: tableStartY,
        head: [['S.No', 'Item', 'Qty', 'Unit', 'Price', ...(showDiscount ? ['Discount'] : []), 'Total']],
        body: pageItems.map((it, i) => [
          String(serial + i + 1),
          it.display_name || it.products?.name || '',
          String(it.quantity),
          it.unit ?? '',
          formatMoney(it.rate),
          ...(showDiscount ? [formatMoney(it.discount)] : []),
          formatMoney(it.amount),
        ]),
        styles: { fontSize: 9 },
        headStyles: { fillColor: [122, 31, 31] },
      })
      serial += pageItems.length
    })

    let y = doc.lastAutoTable.finalY + 10
    if (y > 270) {
      doc.addPage()
      y = 20
    }
    doc.setFontSize(showSurcharge ? 10 : 12)
    doc.text(`Total: ${formatMoney(invoice.subtotal)}`, 150, y)
    y += showSurcharge ? 5 : 7
    if (showSurcharge) {
      doc.text(formatMoney(invoice.gst_amount), 150, y)
      y += 7
      doc.setFontSize(12)
      doc.text(`Net Total: ${formatMoney(invoice.total)}`, 150, y)
      y += 7
    }
    doc.setFontSize(10)
    doc.text(`Paid: ${formatMoney(invoice.paid_amount)}`, 150, y)
    y += 5
    doc.text(`Balance: ${formatMoney(invoice.balance)}`, 150, y)
    y += 6

    if (footerImageUrl) {
      const footerInfo = await loadImageInfo(footerImageUrl)
      const footerWidth = 182
      const footerHeight = footerWidth / (footerInfo.width / footerInfo.height)
      doc.addImage(footerInfo.dataUrl, footerInfo.format, 14, y + 6, footerWidth, footerHeight)
    }

    return doc
  }

  async function downloadPdf() {
    const doc = await buildPdf()
    if (!doc) return
    doc.save(`${invoice.invoice_number}.pdf`)
  }

  // Printing the PDF itself (rather than the live HTML page) avoids the
  // browser's own page header/footer (URL, date/time) that window.print()
  // adds to a printed webpage -- a PDF prints as-is.
  async function handlePrint() {
    const doc = await buildPdf()
    if (!doc) return
    doc.autoPrint()
    window.open(doc.output('bloburl'), '_blank')
  }

  async function startEdit() {
    setEditError('')
    setEditLines(
      items.map((it) => ({
        key: it.id,
        itemId: it.id,
        product_id: it.product_id,
        display_name: it.display_name || it.products?.name || '',
        unit: it.unit,
        quantity: it.quantity,
        rate: it.rate,
        discount: it.discount,
      }))
    )
    setNewLineProduct('')
    const [{ data: productData }, { data: channelData }, { data: yieldItems }] = await Promise.all([
      supabase
        .from('products')
        .select(
          'id, name, sales_unit, unit, default_selling_price, restaurant_price, counter_price, sales_to_inventory_factor'
        )
        .eq('is_active', true)
        .order('name'),
      supabase.from('product_channel_config').select('product_id, channel, display_name, is_visible'),
      supabase
        .from('yield_configuration_items')
        .select('child_product_id, is_active, yield_configurations!inner(parent_product_id, is_active)')
        .eq('is_active', true)
        .eq('yield_configurations.is_active', true),
    ])
    const channelMap = {}
    ;(channelData ?? []).forEach((row) => {
      if (!channelMap[row.product_id]) channelMap[row.product_id] = {}
      channelMap[row.product_id][row.channel] = { display_name: row.display_name, is_visible: row.is_visible }
    })
    const products = (productData ?? [])
      .filter((p) => channelMap[p.id]?.[invoice.channel]?.is_visible !== false)
      .map((p) => ({ ...p, channelName: channelMap[p.id]?.[invoice.channel]?.display_name || p.name }))
    setEditProducts(products)

    // Children never hold their own stock -- a sale of a yield-child (e.g.
    // Mutton Boneless) deducts the equivalent weight from its parent (e.g.
    // Mutton) instead. Mirrors trg_sale_item_stock_movement() in schema.sql
    // so an edited quantity recomputes the deduction the same way the
    // original insert did.
    const parentIdByChild = {}
    ;(yieldItems ?? []).forEach((y) => {
      parentIdByChild[y.child_product_id] = y.yield_configurations.parent_product_id
    })
    const unitById = {}
    ;(productData ?? []).forEach((p) => {
      unitById[p.id] = p.unit
    })
    const metaMap = {}
    ;(productData ?? []).forEach((p) => {
      const parentId = parentIdByChild[p.id] ?? null
      metaMap[p.id] = {
        unit: p.unit,
        factor: p.sales_to_inventory_factor ?? 1,
        parentId,
        parentUnit: parentId ? unitById[parentId] : null,
      }
    })
    setStockMeta(metaMap)
    setEditing(true)
  }

  // Quantity of the target product (the yield-parent, if any, else the
  // product itself) that a sale of `qty` of `productId` should deduct.
  function resolveDeductQty(productId, qty) {
    const meta = stockMeta[productId]
    if (!meta) return Math.abs(qty)
    const conv = meta.parentId ? unitConversionFactor(meta.unit, meta.parentUnit) : 1
    return Math.abs(qty) * meta.factor * conv
  }

  function updateEditLine(key, patch) {
    setEditLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }

  function removeEditLine(key) {
    setEditLines((prev) => prev.filter((l) => l.key !== key))
  }

  function addEditLine() {
    const product = editProducts.find((p) => p.id === newLineProduct)
    if (!product) return
    const channelPrice = invoice.channel === 'Restaurant' ? product.restaurant_price : product.counter_price
    setEditLines((prev) => [
      ...prev,
      {
        key: crypto.randomUUID(),
        itemId: null,
        product_id: product.id,
        display_name: product.channelName,
        unit: product.sales_unit,
        quantity: 1,
        rate: channelPrice ?? product.default_selling_price ?? 0,
        discount: 0,
      },
    ])
    setNewLineProduct('')
  }

  function editLineAmount(line) {
    const qty = Number(line.quantity) || 0
    const rate = Number(line.rate) || 0
    const discount = Number(line.discount) || 0
    return round2(qty * rate - discount)
  }

  async function handleSaveEdit() {
    setEditError('')
    if (editLines.length === 0) {
      setEditError('Invoice must have at least one item line.')
      return
    }
    if (editLines.some((l) => Number(l.quantity) <= 0)) {
      setEditError('Quantity must be greater than 0 for every line.')
      return
    }
    setEditSaving(true)

    const keptItemIds = new Set(editLines.filter((l) => l.itemId).map((l) => l.itemId))
    const removedItems = items.filter((it) => !keptItemIds.has(it.id))

    for (const it of removedItems) {
      const { error: stockErr } = await supabase
        .from('stock_movements')
        .delete()
        .eq('reference_type', 'sale')
        .eq('reference_id', it.id)
      if (stockErr) {
        setEditSaving(false)
        setEditError(stockErr.message)
        return
      }
      const { error: delErr } = await supabase.from('sale_invoice_items').delete().eq('id', it.id)
      if (delErr) {
        setEditSaving(false)
        setEditError(delErr.message)
        return
      }
    }

    for (const line of editLines.filter((l) => l.itemId)) {
      const original = items.find((it) => it.id === line.itemId)
      const newQty = Number(line.quantity)
      const newRate = Number(line.rate) || 0
      const qtyChanged = newQty !== Number(original.quantity)
      const rateChanged = newRate !== Number(original.rate)

      if (!qtyChanged && !rateChanged) continue

      const { error: updErr } = await supabase
        .from('sale_invoice_items')
        .update({ quantity: newQty, rate: newRate })
        .eq('id', line.itemId)
      if (updErr) {
        setEditSaving(false)
        setEditError(updErr.message)
        return
      }

      if (qtyChanged) {
        const deductQty = resolveDeductQty(original.product_id, newQty)
        const { error: stockErr } = await supabase
          .from('stock_movements')
          .update({ quantity: -deductQty })
          .eq('reference_type', 'sale')
          .eq('reference_id', line.itemId)
        if (stockErr) {
          setEditSaving(false)
          setEditError(stockErr.message)
          return
        }
      }
    }

    const newLines = editLines.filter((l) => !l.itemId)
    if (newLines.length) {
      const rows = newLines.map((l) => ({
        sale_invoice_id: invoiceId,
        product_id: l.product_id,
        quantity: Number(l.quantity),
        unit: l.unit || null,
        rate: Number(l.rate) || 0,
        discount: Number(l.discount) || 0,
        gst_applicable: true,
        gst_amount: 0,
        display_name: l.display_name || null,
      }))
      const { error: insErr } = await supabase.from('sale_invoice_items').insert(rows)
      if (insErr) {
        setEditSaving(false)
        setEditError(insErr.message)
        return
      }
    }

    const newSubtotal = round2(editLines.reduce((sum, l) => sum + editLineAmount(l), 0))
    let newGstAmount = 0
    if (invoice.channel === 'Restaurant' && invoice.surcharge_applicable) {
      const rates = await fetchRateHistory()
      const rate = buildRateResolver(rates)(invoice.date)
      newGstAmount = roundSurcharge(newSubtotal * (rate / 100))
    }

    const { error: invErr } = await supabase
      .from('sale_invoices')
      .update({ subtotal: newSubtotal, gst_amount: newGstAmount })
      .eq('id', invoiceId)

    setEditSaving(false)
    if (invErr) {
      setEditError(invErr.message)
      return
    }

    setEditing(false)
    load()
  }

  async function handleDelete() {
    if (!window.confirm(`Delete invoice ${invoice.invoice_number}? This will restore the stock it deducted and cannot be undone.`))
      return
    setDeleting(true)
    setDeleteError('')
    // Reverse the stock deducted by this invoice's items first — deleting the
    // invoice cascades away the line items, but the stock_movements they
    // logged aren't linked by a foreign key, so they'd otherwise be orphaned
    // and leave stock permanently understated.
    const itemIds = items.map((it) => it.id)
    if (itemIds.length) {
      const { error: stockError } = await supabase
        .from('stock_movements')
        .delete()
        .eq('reference_type', 'sale')
        .in('reference_id', itemIds)
      if (stockError) {
        setDeleting(false)
        setDeleteError(stockError.message)
        return
      }
    }
    const { error } = await supabase.from('sale_invoices').delete().eq('id', invoiceId)
    setDeleting(false)
    if (error) {
      setDeleteError(error.message)
      return
    }
    if (onDeleted) onDeleted()
    else if (onClose) onClose()
  }

  if (loading) return <p className="muted">Loading invoice…</p>
  if (!invoice) return <p className="inline-error">Invoice not found.</p>

  // Keep the Discount field available at entry time, but don't clutter the
  // printed invoice with a column of zeroes when no discount was actually given.
  const hasDiscount = items.some((it) => Number(it.discount) > 0)

  return (
    <div>
      <div className="toolbar no-print">
        <button className="btn" onClick={handlePrint}>
          Print
        </button>
        <button className="btn-secondary" onClick={downloadPdf}>
          Download PDF
        </button>
        {!editing && (
          <button className="btn-secondary" onClick={startEdit}>
            Edit Invoice
          </button>
        )}
        {isAdmin && (
          <button className="btn-danger" disabled={deleting} onClick={handleDelete}>
            {deleting ? 'Deleting…' : 'Delete Invoice'}
          </button>
        )}
        {onClose && (
          <button className="btn-secondary" onClick={onClose}>
            Close
          </button>
        )}
      </div>
      {deleteError && <div className="inline-error no-print">{deleteError}</div>}

      {editing && (
        <div className="card no-print">
          <h3>Edit Invoice {invoice.invoice_number}</h3>
          <p className="muted" style={{ fontSize: '0.85rem' }}>
            Adjust quantity and price, add a forgotten item, or remove one. Stock is adjusted to match
            (restored on removal, corrected on quantity change), and the invoice total recalculates
            accordingly.
          </p>
          <table className="data-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Qty</th>
                <th>Unit</th>
                <th>Price</th>
                <th>Discount</th>
                <th>Total</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {editLines.map((line) => (
                <tr key={line.key}>
                  <td>{line.display_name || '—'}</td>
                  <td>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      style={{ width: 80 }}
                      value={line.quantity}
                      onChange={(e) => updateEditLine(line.key, { quantity: e.target.value })}
                    />
                  </td>
                  <td>{line.unit}</td>
                  <td>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      style={{ width: 90 }}
                      value={line.rate}
                      onChange={(e) => updateEditLine(line.key, { rate: e.target.value })}
                    />
                  </td>
                  <td>{formatMoney(line.discount)}</td>
                  <td>{formatMoney(editLineAmount(line))}</td>
                  <td>
                    <button type="button" className="btn-secondary" onClick={() => removeEditLine(line.key)}>
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
              {editLines.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted">
                    No items — add one below.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <div className="toolbar" style={{ marginTop: '0.75rem' }}>
            <select value={newLineProduct} onChange={(e) => setNewLineProduct(e.target.value)}>
              <option value="">Select item to add…</option>
              {editProducts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.channelName}
                </option>
              ))}
            </select>
            <button type="button" className="btn-secondary" disabled={!newLineProduct} onClick={addEditLine}>
              + Add Line
            </button>
          </div>

          <div className="toolbar" style={{ marginTop: '1rem' }}>
            <button className="btn" disabled={editSaving} onClick={handleSaveEdit}>
              {editSaving ? 'Saving…' : 'Save Changes'}
            </button>
            <button className="btn-secondary" disabled={editSaving} onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
          {editError && <div className="inline-error">{editError}</div>}
        </div>
      )}

      <div className="invoice-sheet" style={editing ? { display: 'none' } : undefined}>
        <img src={headerImageUrl} alt={COMPANY.name} className="invoice-banner" />

        <div className="invoice-meta-row">
          <div>
            <div className="invoice-legal-name muted">Bill To:</div>
            <strong>{invoice.customers?.name ?? 'Counter Sale'}</strong>
            {invoice.customers?.address && (
              <div className="muted" style={{ whiteSpace: 'pre-line', fontSize: '0.85rem' }}>
                {invoice.customers.address}
              </div>
            )}
            {invoice.customers?.contact && (
              <div className="muted" style={{ fontSize: '0.85rem' }}>
                {invoice.customers.contact}
              </div>
            )}
          </div>
          <div style={{ textAlign: 'right' }}>
            <h1 style={{ margin: 0 }}>INVOICE</h1>
            <p style={{ margin: '0.2rem 0' }}>Invoice No: <strong>{invoice.invoice_number}</strong></p>
            <p style={{ margin: '0.2rem 0' }}>Date: {formatDate(invoice.date)}</p>
            <p style={{ margin: '0.2rem 0' }}>Payment: {invoice.payment_type}</p>
            {invoice.payment_type === 'Credit' && invoice.due_date && (
              <p style={{ margin: '0.2rem 0' }}>Due: {formatDate(invoice.due_date)}</p>
            )}
          </div>
        </div>

        <table className="data-table invoice-items">
          <thead>
            <tr>
              <th>S.No</th>
              <th>Item</th>
              <th>Qty</th>
              <th>Unit</th>
              <th>Price</th>
              {hasDiscount && <th>Discount</th>}
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => {
              const isPageBreak = (i + 1) % 14 === 0 && i + 1 < items.length
              return (
                <tr key={it.id} style={isPageBreak ? { breakAfter: 'page' } : undefined}>
                  <td>{i + 1}</td>
                  <td>{it.display_name || it.products?.name || '—'}</td>
                  <td>{it.quantity}</td>
                  <td>{it.unit}</td>
                  <td>{formatMoney(it.rate)}</td>
                  {hasDiscount && <td>{formatMoney(it.discount)}</td>}
                  <td>{formatMoney(it.amount)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>

        <div className="invoice-totals">
          <table>
            <tbody>
              <tr style={{ fontWeight: showSurcharge ? 400 : 700 }}>
                <td>Total</td>
                <td>{formatMoney(invoice.subtotal)}</td>
              </tr>
              {showSurcharge && (
                <>
                  <tr>
                    <td></td>
                    <td>{formatMoney(invoice.gst_amount)}</td>
                  </tr>
                  <tr style={{ fontWeight: 700 }}>
                    <td>Net Total</td>
                    <td>{formatMoney(invoice.total)}</td>
                  </tr>
                </>
              )}
              <tr>
                <td>Paid</td>
                <td>{formatMoney(invoice.paid_amount)}</td>
              </tr>
              <tr style={{ fontWeight: 700 }}>
                <td>Balance</td>
                <td>{formatMoney(invoice.balance)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {invoice.remarks && (
          <p>
            <strong>Remarks:</strong> {invoice.remarks}
          </p>
        )}

        <div className="invoice-footer">
          {footerImageUrl && <img src={footerImageUrl} alt="" className="invoice-banner" style={{ marginTop: '1rem' }} />}
        </div>
      </div>
    </div>
  )
}
