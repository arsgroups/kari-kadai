import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { formatDate, formatMoney } from '../../lib/format'
import { COMPANY } from '../../lib/companyInfo'
import invoiceHeaderImg from '../../assets/invoice-header.jpg'
import { useAuth } from '../../contexts/AuthContext'

// Fetches an image (bundled asset or a configured Storage URL) and resolves
// its PDF-ready data URL along with format + natural size, so a custom
// upload of any aspect ratio still renders at the correct proportions.
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

  async function downloadPdf() {
    if (!invoice) return
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

    autoTable(doc, {
      startY: metaY + 23 + addressExtra,
      head: [['Item', 'Qty', 'Unit', 'Price', ...(showDiscount ? ['Discount'] : []), 'Total']],
      body: items.map((it) => [
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

    let y = doc.lastAutoTable.finalY + 10
    doc.setFontSize(isRestaurant ? 10 : 12)
    doc.text(`Total: ${formatMoney(invoice.subtotal)}`, 150, y)
    y += isRestaurant ? 5 : 7
    if (isRestaurant) {
      doc.text(`S$${Math.round(Number(invoice.gst_amount))}`, 150, y)
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

    doc.setFontSize(11)
    doc.text('Thank you for your business!', 14, y)

    if (footerImageUrl) {
      const footerInfo = await loadImageInfo(footerImageUrl)
      const footerWidth = 182
      const footerHeight = footerWidth / (footerInfo.width / footerInfo.height)
      doc.addImage(footerInfo.dataUrl, footerInfo.format, 14, y + 6, footerWidth, footerHeight)
    }

    doc.save(`${invoice.invoice_number}.pdf`)
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
        <button className="btn" onClick={() => window.print()}>
          Print
        </button>
        <button className="btn-secondary" onClick={downloadPdf}>
          Download PDF
        </button>
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

      <div className="invoice-sheet">
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
              <th>Item</th>
              <th>Qty</th>
              <th>Unit</th>
              <th>Price</th>
              {hasDiscount && <th>Discount</th>}
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id}>
                <td>{it.display_name || it.products?.name || '—'}</td>
                <td>{it.quantity}</td>
                <td>{it.unit}</td>
                <td>{formatMoney(it.rate)}</td>
                {hasDiscount && <td>{formatMoney(it.discount)}</td>}
                <td>{formatMoney(it.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="invoice-totals">
          <table>
            <tbody>
              <tr style={{ fontWeight: isRestaurant ? 400 : 700 }}>
                <td>Total</td>
                <td>{formatMoney(invoice.subtotal)}</td>
              </tr>
              {isRestaurant && (
                <>
                  <tr>
                    <td></td>
                    <td>S${Math.round(Number(invoice.gst_amount))}</td>
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
          <p>Thank you for your business!</p>
          <div className="invoice-signature">Signature: ______________________</div>
          {footerImageUrl && <img src={footerImageUrl} alt="" className="invoice-banner" style={{ marginTop: '1rem' }} />}
        </div>
      </div>
    </div>
  )
}
