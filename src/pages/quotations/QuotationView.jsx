import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { formatDate, formatMoney, toISODate } from '../../lib/format'
import { COMPANY } from '../../lib/companyInfo'
import invoiceHeaderImg from '../../assets/invoice-header.jpg'
import { useAuth } from '../../contexts/AuthContext'
import SearchableSelect from '../../components/SearchableSelect'

const VALID_DAYS = 10

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

function validUntil(date) {
  const d = new Date(date)
  d.setDate(d.getDate() + VALID_DAYS)
  return toISODate(d)
}

export default function QuotationView({ quotationId, onClose, onDeleted }) {
  const { isAdmin } = useAuth()
  const [quotation, setQuotation] = useState(null)
  const [items, setItems] = useState([])
  const [branding, setBranding] = useState(null)
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState(null)
  const [editItems, setEditItems] = useState([])
  const [editProducts, setEditProducts] = useState([]) // channel-visible products, for the Add Item picker
  const [newItemProduct, setNewItemProduct] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState('')

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quotationId])

  async function load() {
    setLoading(true)
    const [{ data: quo }, { data: itemRows }, { data: brandingRow }] = await Promise.all([
      supabase.from('quotations').select('*').eq('id', quotationId).single(),
      supabase.from('quotation_items').select('*').eq('quotation_id', quotationId).order('created_at'),
      supabase.from('branding_settings').select('header_image_url').single(),
    ])
    setQuotation(quo)
    setItems(itemRows ?? [])
    setBranding(brandingRow)
    setLoading(false)
  }

  const headerImageUrl = branding?.header_image_url || invoiceHeaderImg

  function itemPrice(it) {
    return it.special_price ?? it.listed_price ?? 0
  }

  // Clarifies the price is per that quantity, e.g. "1 Kg" / "1 Unit" rather
  // than a bare "Kg" / "Unit".
  function unitLabel(unit) {
    return unit ? `1 ${unit}` : ''
  }

  async function startEdit() {
    setEditError('')
    setEditForm({
      date: quotation.date,
      channel: quotation.channel,
      customer_name: quotation.customer_name || '',
      customer_address: quotation.customer_address || '',
      customer_contact: quotation.customer_contact || '',
      sent_by_name: quotation.sent_by_name || '',
      sent_by_contact: quotation.sent_by_contact || '',
    })
    setEditItems(
      items.map((it) => ({
        key: it.id,
        itemId: it.id,
        product_id: it.product_id,
        display_name: it.display_name,
        unit: it.unit || '',
        listed_price: it.listed_price ?? '',
        special_price: it.special_price ?? '',
      }))
    )
    setNewItemProduct('')
    const [{ data: productData }, { data: channelData }] = await Promise.all([
      supabase
        .from('products')
        .select('id, name, sales_unit, default_selling_price, restaurant_price, counter_price, supplier_only')
        .eq('is_active', true)
        .order('name'),
      supabase.from('product_channel_config').select('product_id, channel, display_name, is_visible'),
    ])
    const channelMap = {}
    ;(channelData ?? []).forEach((row) => {
      if (!channelMap[row.product_id]) channelMap[row.product_id] = {}
      channelMap[row.product_id][row.channel] = { display_name: row.display_name, is_visible: row.is_visible }
    })
    const products = (productData ?? [])
      .filter((p) => !p.supplier_only && channelMap[p.id]?.[quotation.channel]?.is_visible !== false)
      .map((p) => ({
        ...p,
        channelName: channelMap[p.id]?.[quotation.channel]?.display_name || p.name,
        listedPrice: (quotation.channel === 'Restaurant' ? p.restaurant_price : p.counter_price) ?? p.default_selling_price,
      }))
    setEditProducts(products)
    setEditing(true)
  }

  function updateEditItem(key, patch) {
    setEditItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)))
  }

  function removeEditItem(key) {
    setEditItems((prev) => prev.filter((it) => it.key !== key))
  }

  function addEditItem() {
    const product = editProducts.find((p) => p.id === newItemProduct)
    if (!product) return
    setEditItems((prev) => [
      ...prev,
      {
        key: crypto.randomUUID(),
        itemId: null,
        product_id: product.id,
        display_name: product.channelName,
        unit: product.sales_unit || '',
        listed_price: product.listedPrice ?? '',
        special_price: '',
      },
    ])
    setNewItemProduct('')
  }

  async function handleSaveEdit() {
    setEditError('')
    if (!editForm.customer_name.trim()) {
      setEditError('Enter the customer name.')
      return
    }
    if (editItems.length === 0) {
      setEditError('At least one item must remain in the quotation.')
      return
    }
    setEditSaving(true)

    const { error: quoError } = await supabase
      .from('quotations')
      .update({
        date: editForm.date,
        channel: editForm.channel,
        customer_name: editForm.customer_name,
        customer_address: editForm.customer_address || null,
        customer_contact: editForm.customer_contact || null,
        sent_by_name: editForm.sent_by_name || null,
        sent_by_contact: editForm.sent_by_contact || null,
      })
      .eq('id', quotationId)
    if (quoError) {
      setEditSaving(false)
      setEditError(quoError.message)
      return
    }

    const keptItemIds = new Set(editItems.filter((it) => it.itemId).map((it) => it.itemId))
    const removedIds = items.filter((it) => !keptItemIds.has(it.id)).map((it) => it.id)
    if (removedIds.length) {
      const { error: delError } = await supabase.from('quotation_items').delete().in('id', removedIds)
      if (delError) {
        setEditSaving(false)
        setEditError(delError.message)
        return
      }
    }

    for (const it of editItems.filter((it) => it.itemId)) {
      const { error } = await supabase
        .from('quotation_items')
        .update({
          display_name: it.display_name,
          unit: it.unit || null,
          listed_price: it.listed_price === '' ? null : Number(it.listed_price),
          special_price: it.special_price === '' ? null : Number(it.special_price),
        })
        .eq('id', it.itemId)
      if (error) {
        setEditSaving(false)
        setEditError(error.message)
        return
      }
    }

    const newRows = editItems
      .filter((it) => !it.itemId)
      .map((it) => ({
        quotation_id: quotationId,
        product_id: it.product_id,
        display_name: it.display_name,
        unit: it.unit || null,
        listed_price: it.listed_price === '' ? null : Number(it.listed_price),
        special_price: it.special_price === '' ? null : Number(it.special_price),
      }))
    if (newRows.length) {
      const { error: insError } = await supabase.from('quotation_items').insert(newRows)
      if (insError) {
        setEditSaving(false)
        setEditError(insError.message)
        return
      }
    }

    setEditSaving(false)
    setEditing(false)
    load()
  }

  async function downloadPdf() {
    if (!quotation) return
    const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
      import('jspdf'),
      import('jspdf-autotable'),
    ])
    const doc = new jsPDF()

    const bannerWidth = 182
    const headerInfo = await loadImageInfo(headerImageUrl)
    const bannerHeight = bannerWidth / (headerInfo.width / headerInfo.height)
    doc.addImage(headerInfo.dataUrl, headerInfo.format, 14, 10, bannerWidth, bannerHeight)

    const metaY = 10 + bannerHeight + 8
    doc.setFontSize(8)
    doc.text('To:', 14, metaY)
    doc.setFontSize(10)
    doc.text(quotation.customer_name, 14, metaY + 4)
    const addressLines = quotation.customer_address ? quotation.customer_address.split('\n').filter(Boolean) : []
    doc.setFontSize(9)
    if (addressLines.length) doc.text(addressLines, 14, metaY + 9)
    const addressExtra = Math.max(addressLines.length - 1, 0) * 5
    if (quotation.customer_contact) doc.text(quotation.customer_contact, 14, metaY + 9 + addressExtra + 4)

    doc.setFontSize(14)
    doc.text('QUOTATION', 150, metaY - 4)
    doc.setFontSize(10)
    doc.text(`Quotation No: ${quotation.quotation_number}`, 150, metaY + 3)
    doc.text(`Date: ${formatDate(quotation.date)}`, 150, metaY + 8)
    doc.text(`Channel: ${quotation.channel}`, 150, metaY + 13)

    autoTable(doc, {
      startY: metaY + 23 + addressExtra,
      head: [['S.No', 'Item', 'Unit', 'Price']],
      body: items.map((it, i) => [String(i + 1), it.display_name, unitLabel(it.unit), formatMoney(itemPrice(it))]),
      styles: { fontSize: 9 },
      headStyles: { fillColor: [122, 31, 31] },
    })

    let finalY = doc.lastAutoTable.finalY + 10
    if (quotation.sent_by_name || quotation.sent_by_contact) {
      doc.setFontSize(10)
      doc.text(
        `Quotation sent by: ${quotation.sent_by_name ?? ''}${quotation.sent_by_contact ? `  (${quotation.sent_by_contact})` : ''}`,
        14,
        finalY
      )
      finalY += 7
    }

    doc.setFontSize(9)
    doc.text('Local taxes excluded. Door delivery free.', 14, finalY)
    doc.text(`Quotation valid for ${VALID_DAYS} days (until ${formatDate(validUntil(quotation.date))}).`, 14, finalY + 5)

    doc.save(`${quotation.quotation_number}.pdf`)
  }

  async function handleDelete() {
    if (!window.confirm(`Delete quotation ${quotation.quotation_number}? This cannot be undone.`)) return
    setDeleting(true)
    setDeleteError('')
    const { error } = await supabase.from('quotations').delete().eq('id', quotationId)
    setDeleting(false)
    if (error) {
      setDeleteError(error.message)
      return
    }
    if (onDeleted) onDeleted()
    else if (onClose) onClose()
  }

  if (loading) return <p className="muted">Loading quotation…</p>
  if (!quotation) return <p className="inline-error">Quotation not found.</p>

  return (
    <div>
      <div className="toolbar no-print">
        <button className="btn" onClick={() => window.print()}>
          Print
        </button>
        <button className="btn-secondary" onClick={downloadPdf}>
          Download PDF
        </button>
        {!editing && (
          <button className="btn-secondary" onClick={startEdit}>
            Edit Quotation
          </button>
        )}
        {isAdmin && (
          <button className="btn-danger" disabled={deleting} onClick={handleDelete}>
            {deleting ? 'Deleting…' : 'Delete Quotation'}
          </button>
        )}
        {onClose && (
          <button className="btn-secondary" onClick={onClose}>
            Close
          </button>
        )}
      </div>
      {deleteError && <div className="inline-error no-print">{deleteError}</div>}

      {editing && editForm && (
        <div className="card no-print">
          <h3>Edit Quotation {quotation.quotation_number}</h3>
          <p className="muted" style={{ fontSize: '0.85rem' }}>
            A quotation has no stock or accounting impact, so items and prices can be freely adjusted, added,
            or removed.
          </p>
          <div className="form-grid">
            <label>
              Channel
              <select value={editForm.channel} onChange={(e) => setEditForm({ ...editForm, channel: e.target.value })}>
                <option>Restaurant</option>
                <option>Home Delivery</option>
                <option>Counter</option>
              </select>
            </label>
            <label>
              Date
              <input
                type="date"
                value={editForm.date}
                onChange={(e) => setEditForm({ ...editForm, date: e.target.value })}
              />
            </label>
            <label>
              Customer Name
              <input
                value={editForm.customer_name}
                onChange={(e) => setEditForm({ ...editForm, customer_name: e.target.value })}
              />
            </label>
            <label>
              Customer Address
              <textarea
                rows={2}
                value={editForm.customer_address}
                onChange={(e) => setEditForm({ ...editForm, customer_address: e.target.value })}
              />
            </label>
            <label>
              Customer Contact
              <input
                value={editForm.customer_contact}
                onChange={(e) => setEditForm({ ...editForm, customer_contact: e.target.value })}
              />
            </label>
            <label>
              Quotation Sent By
              <input
                value={editForm.sent_by_name}
                onChange={(e) => setEditForm({ ...editForm, sent_by_name: e.target.value })}
              />
            </label>
            <label>
              Sender Contact Number
              <input
                value={editForm.sent_by_contact}
                onChange={(e) => setEditForm({ ...editForm, sent_by_contact: e.target.value })}
              />
            </label>
          </div>

          <table className="data-table" style={{ marginTop: '1rem' }}>
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
              {editItems.map((it) => (
                <tr key={it.key}>
                  <td>
                    <input
                      style={{ width: 180 }}
                      value={it.display_name}
                      onChange={(e) => updateEditItem(it.key, { display_name: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      style={{ width: 70 }}
                      value={it.unit}
                      onChange={(e) => updateEditItem(it.key, { unit: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      style={{ width: 90 }}
                      value={it.listed_price}
                      onChange={(e) => updateEditItem(it.key, { listed_price: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      style={{ width: 90 }}
                      placeholder={it.listed_price !== '' ? String(it.listed_price) : ''}
                      value={it.special_price}
                      onChange={(e) => updateEditItem(it.key, { special_price: e.target.value })}
                    />
                  </td>
                  <td>
                    <button type="button" className="btn-secondary" onClick={() => removeEditItem(it.key)}>
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
              {editItems.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    No items — add one below.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <div className="toolbar" style={{ marginTop: '0.75rem' }}>
            <SearchableSelect
              value={newItemProduct}
              onChange={setNewItemProduct}
              options={editProducts.map((p) => ({ value: p.id, label: p.channelName }))}
              placeholder="Select item to add…"
            />
            <button type="button" className="btn-secondary" disabled={!newItemProduct} onClick={addEditItem}>
              + Add Item
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
            <div className="invoice-legal-name muted">To:</div>
            <strong>{quotation.customer_name}</strong>
            {quotation.customer_address && (
              <div className="muted" style={{ whiteSpace: 'pre-line', fontSize: '0.85rem' }}>
                {quotation.customer_address}
              </div>
            )}
            {quotation.customer_contact && (
              <div className="muted" style={{ fontSize: '0.85rem' }}>
                {quotation.customer_contact}
              </div>
            )}
          </div>
          <div style={{ textAlign: 'right' }}>
            <h1 style={{ margin: 0 }}>QUOTATION</h1>
            <p style={{ margin: '0.2rem 0' }}>
              Quotation No: <strong>{quotation.quotation_number}</strong>
            </p>
            <p style={{ margin: '0.2rem 0' }}>Date: {formatDate(quotation.date)}</p>
            <p style={{ margin: '0.2rem 0' }}>Channel: {quotation.channel}</p>
          </div>
        </div>

        <table className="data-table invoice-items">
          <thead>
            <tr>
              <th>S.No</th>
              <th>Item</th>
              <th>Unit</th>
              <th>Price</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={it.id}>
                <td>{i + 1}</td>
                <td>{it.display_name}</td>
                <td>{unitLabel(it.unit)}</td>
                <td>{formatMoney(itemPrice(it))}</td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  No items.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {(quotation.sent_by_name || quotation.sent_by_contact) && (
          <p style={{ marginTop: '1rem' }}>
            <strong>Quotation sent by:</strong> {quotation.sent_by_name}
            {quotation.sent_by_contact ? ` (${quotation.sent_by_contact})` : ''}
          </p>
        )}

        <div className="invoice-footer">
          <p className="muted" style={{ margin: '0.2rem 0' }}>
            Local taxes excluded. Door delivery free.
          </p>
          <p className="muted" style={{ margin: '0.2rem 0' }}>
            Quotation valid for {VALID_DAYS} days (until {formatDate(validUntil(quotation.date))}).
          </p>
        </div>
      </div>
    </div>
  )
}
