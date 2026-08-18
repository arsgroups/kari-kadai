import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { formatDate, formatMoney, toISODate } from '../../lib/format'
import { COMPANY } from '../../lib/companyInfo'
import invoiceHeaderImg from '../../assets/invoice-header.jpg'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { useAuth } from '../../contexts/AuthContext'

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

  async function downloadPdf() {
    if (!quotation) return
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

      <div className="invoice-sheet">
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
