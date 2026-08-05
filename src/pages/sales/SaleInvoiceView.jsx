import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { formatDate, formatMoney } from '../../lib/format'
import { COMPANY } from '../../lib/companyInfo'
import invoiceHeaderImg from '../../assets/invoice-header.jpg'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

function loadImageAsDataUrl(url) {
  return fetch(url)
    .then((res) => res.blob())
    .then(
      (blob) =>
        new Promise((resolve, reject) => {
          const reader = new FileReader()
          reader.onloadend = () => resolve(reader.result)
          reader.onerror = reject
          reader.readAsDataURL(blob)
        })
    )
}

export default function SaleInvoiceView({ invoiceId, onClose }) {
  const [invoice, setInvoice] = useState(null)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceId])

  async function load() {
    setLoading(true)
    const [{ data: inv }, { data: itemRows }] = await Promise.all([
      supabase
        .from('sale_invoices')
        .select('*, customers(name, address, contact)')
        .eq('id', invoiceId)
        .single(),
      supabase
        .from('sale_invoice_items')
        .select('*, products(name)')
        .eq('sale_invoice_id', invoiceId),
    ])
    setInvoice(inv)
    setItems(itemRows ?? [])
    setLoading(false)
  }

  async function downloadPdf() {
    if (!invoice) return
    const doc = new jsPDF()

    // Banner is 936x324px (~2.889:1) — fit it to the usable A4 width (210mm - 2*14mm margin).
    const bannerWidth = 182
    const bannerHeight = bannerWidth / (936 / 324)
    const bannerDataUrl = await loadImageAsDataUrl(invoiceHeaderImg)
    doc.addImage(bannerDataUrl, 'JPEG', 14, 10, bannerWidth, bannerHeight)

    const metaY = 10 + bannerHeight + 8
    doc.setFontSize(10)
    doc.text(COMPANY.name, 14, metaY)

    doc.setFontSize(14)
    doc.text('TAX INVOICE', 150, metaY - 4)
    doc.setFontSize(10)
    doc.text(`Invoice No: ${invoice.invoice_number}`, 150, metaY + 3)
    doc.text(`Date: ${formatDate(invoice.date)}`, 150, metaY + 8)
    doc.text(`Payment: ${invoice.payment_type}`, 150, metaY + 13)

    doc.text(`Customer: ${invoice.customers?.name ?? 'Counter Sale'}`, 14, metaY + 10)
    if (invoice.customers?.address) doc.text(invoice.customers.address, 14, metaY + 15)

    autoTable(doc, {
      startY: metaY + 23,
      head: [['Item', 'Qty', 'Unit', 'Price', 'Discount', 'GST', 'Total']],
      body: items.map((it) => [
        it.products?.name ?? '',
        String(it.quantity),
        it.unit ?? '',
        formatMoney(it.rate),
        formatMoney(it.discount),
        it.gst_applicable ? formatMoney(it.gst_amount) : '-',
        formatMoney(it.amount + (it.gst_applicable ? it.gst_amount : 0)),
      ]),
      styles: { fontSize: 9 },
      headStyles: { fillColor: [122, 31, 31] },
    })

    const finalY = doc.lastAutoTable.finalY + 10
    doc.setFontSize(10)
    doc.text(`Subtotal: ${formatMoney(invoice.subtotal)}`, 150, finalY)
    doc.text(`GST: ${formatMoney(invoice.gst_amount)}`, 150, finalY + 5)
    doc.setFontSize(12)
    doc.text(`Grand Total: ${formatMoney(invoice.total)}`, 150, finalY + 12)
    doc.setFontSize(10)
    doc.text(`Paid: ${formatMoney(invoice.paid_amount)}`, 150, finalY + 19)
    doc.text(`Balance: ${formatMoney(invoice.balance)}`, 150, finalY + 24)

    doc.setFontSize(11)
    doc.text('Thank you for your business!', 14, finalY + 30)

    doc.save(`${invoice.invoice_number}.pdf`)
  }

  if (loading) return <p className="muted">Loading invoice…</p>
  if (!invoice) return <p className="inline-error">Invoice not found.</p>

  return (
    <div>
      <div className="toolbar no-print">
        <button className="btn" onClick={() => window.print()}>
          Print
        </button>
        <button className="btn-secondary" onClick={downloadPdf}>
          Download PDF
        </button>
        {onClose && (
          <button className="btn-secondary" onClick={onClose}>
            Close
          </button>
        )}
      </div>

      <div className="invoice-sheet">
        <img src={invoiceHeaderImg} alt={COMPANY.name} className="invoice-banner" />

        <div className="invoice-meta-row">
          <div className="invoice-legal-name muted">{COMPANY.name}</div>
          <div style={{ textAlign: 'right' }}>
            <h1 style={{ margin: 0 }}>TAX INVOICE</h1>
            <p style={{ margin: '0.2rem 0' }}>Invoice No: <strong>{invoice.invoice_number}</strong></p>
            <p style={{ margin: '0.2rem 0' }}>Date: {formatDate(invoice.date)}</p>
            <p style={{ margin: '0.2rem 0' }}>Payment: {invoice.payment_type}</p>
          </div>
        </div>

        <div className="invoice-customer">
          <strong>Bill To:</strong> {invoice.customers?.name ?? 'Counter Sale'}
          {invoice.customers?.address && <div className="muted">{invoice.customers.address}</div>}
          {invoice.customers?.contact && <div className="muted">{invoice.customers.contact}</div>}
        </div>

        <table className="data-table invoice-items">
          <thead>
            <tr>
              <th>Item</th>
              <th>Qty</th>
              <th>Unit</th>
              <th>Price</th>
              <th>Discount</th>
              <th>GST</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id}>
                <td>{it.products?.name ?? '—'}</td>
                <td>{it.quantity}</td>
                <td>{it.unit}</td>
                <td>{formatMoney(it.rate)}</td>
                <td>{formatMoney(it.discount)}</td>
                <td>{it.gst_applicable ? formatMoney(it.gst_amount) : '—'}</td>
                <td>{formatMoney(it.amount + (it.gst_applicable ? it.gst_amount : 0))}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="invoice-totals">
          <table>
            <tbody>
              <tr>
                <td>Subtotal</td>
                <td>{formatMoney(invoice.subtotal)}</td>
              </tr>
              <tr>
                <td>GST</td>
                <td>{formatMoney(invoice.gst_amount)}</td>
              </tr>
              <tr style={{ fontWeight: 700 }}>
                <td>Grand Total</td>
                <td>{formatMoney(invoice.total)}</td>
              </tr>
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
        </div>
      </div>
    </div>
  )
}
