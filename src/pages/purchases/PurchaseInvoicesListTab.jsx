import { Fragment, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { formatDate, formatMoney, toISODate } from '../../lib/format'
import ExportButtons from '../../components/ExportButtons'
import { useAuth } from '../../contexts/AuthContext'

function firstOfMonth() {
  const d = new Date()
  return toISODate(new Date(d.getFullYear(), d.getMonth(), 1))
}

const emptyFilters = { from: firstOfMonth(), to: toISODate(), supplier_id: '' }

export default function PurchaseInvoicesListTab() {
  const { isAdmin } = useAuth()
  const [rows, setRows] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filters, setFilters] = useState(emptyFilters)
  const [expandedId, setExpandedId] = useState(null)
  const [itemsByInvoice, setItemsByInvoice] = useState({})
  const [deletingId, setDeletingId] = useState(null)
  const [paidByInvoice, setPaidByInvoice] = useState({})
  const [payingId, setPayingId] = useState(null)
  const [paymentForm, setPaymentForm] = useState({ amount: '', payment_type: 'Cash', date: toISODate() })
  const [payingSaving, setPayingSaving] = useState(false)

  useEffect(() => {
    supabase.from('suppliers').select('id, name').order('name').then(({ data }) => setSuppliers(data ?? []))
  }, [])

  async function load() {
    setLoading(true)
    setError('')
    let query = supabase
      .from('purchase_invoices')
      .select('id, invoice_number, date, supplier_id, subtotal, gst_amount, total, payment_type, note, suppliers(name)')
      .gte('date', filters.from)
      .lte('date', filters.to)
      .order('date', { ascending: false })

    if (filters.supplier_id) query = query.eq('supplier_id', filters.supplier_id)

    const { data, error } = await query.limit(500)
    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }
    setRows(data ?? [])

    const invoiceIds = (data ?? []).map((r) => r.id)
    if (invoiceIds.length) {
      const { data: paymentRows } = await supabase
        .from('supplier_payments')
        .select('invoice_id, amount')
        .in('invoice_id', invoiceIds)
      const paidMap = {}
      ;(paymentRows ?? []).forEach((p) => {
        paidMap[p.invoice_id] = (paidMap[p.invoice_id] ?? 0) + p.amount
      })
      setPaidByInvoice(paidMap)
    } else {
      setPaidByInvoice({})
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters])

  async function toggleExpand(invoiceId) {
    if (expandedId === invoiceId) {
      setExpandedId(null)
      return
    }
    setExpandedId(invoiceId)
    if (!itemsByInvoice[invoiceId]) {
      const { data } = await supabase
        .from('purchase_invoice_items')
        .select('id, quantity, unit, rate, discount, gst_applicable, gst_amount, amount, products(name)')
        .eq('purchase_invoice_id', invoiceId)
      setItemsByInvoice({ ...itemsByInvoice, [invoiceId]: data ?? [] })
    }
  }

  async function handleDelete(invoice) {
    if (
      !window.confirm(
        `Delete invoice ${invoice.invoice_number}? This restores the stock it added but won't adjust this item's average cost. This cannot be undone.`
      )
    )
      return
    setDeletingId(invoice.id)
    setError('')
    const { data: itemRows, error: itemsError } = await supabase
      .from('purchase_invoice_items')
      .select('id')
      .eq('purchase_invoice_id', invoice.id)
    if (itemsError) {
      setDeletingId(null)
      setError(itemsError.message)
      return
    }
    const itemIds = (itemRows ?? []).map((it) => it.id)
    if (itemIds.length) {
      const { error: stockError } = await supabase
        .from('stock_movements')
        .delete()
        .eq('reference_type', 'purchase')
        .in('reference_id', itemIds)
      if (stockError) {
        setDeletingId(null)
        setError(stockError.message)
        return
      }
    }
    const { error: deleteError } = await supabase.from('purchase_invoices').delete().eq('id', invoice.id)
    setDeletingId(null)
    if (deleteError) {
      setError(deleteError.message)
      return
    }
    setItemsByInvoice((prev) => {
      const next = { ...prev }
      delete next[invoice.id]
      return next
    })
    load()
  }

  function paymentStatus(invoice) {
    if (invoice.payment_type !== 'Credit') return 'Paid'
    const paid = paidByInvoice[invoice.id] ?? 0
    if (paid <= 0) return 'Pending'
    if (paid < invoice.total) return 'Partial'
    return 'Paid'
  }

  function openPayment(invoice) {
    const outstanding = Math.max(invoice.total - (paidByInvoice[invoice.id] ?? 0), 0)
    setPayingId(invoice.id)
    setPaymentForm({ amount: String(outstanding), payment_type: 'Cash', date: toISODate() })
    setError('')
  }

  async function handleRecordPayment(invoice) {
    const amount = Number(paymentForm.amount)
    if (!amount || amount <= 0) {
      setError('Enter a payment amount greater than 0.')
      return
    }
    setPayingSaving(true)
    setError('')
    const { error: payError } = await supabase.from('supplier_payments').insert({
      supplier_id: invoice.supplier_id,
      invoice_id: invoice.id,
      date: paymentForm.date,
      amount,
      payment_type: paymentForm.payment_type,
      note: `Payment for invoice ${invoice.invoice_number}`,
    })
    setPayingSaving(false)
    if (payError) {
      setError(payError.message)
      return
    }
    setPayingId(null)
    load()
  }

  const totalAmount = rows.reduce((sum, r) => sum + r.total, 0)

  const exportRows = rows.map((r) => ({
    invoice_number: r.invoice_number,
    date: formatDate(r.date),
    supplier: r.suppliers?.name,
    subtotal: r.subtotal,
    gst_amount: r.gst_amount,
    total: r.total,
    payment_type: r.payment_type,
  }))

  return (
    <div>
      <div className="card">
        <div className="form-grid">
          <label>
            From
            <input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
          </label>
          <label>
            To
            <input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
          </label>
          <label>
            Supplier
            <select value={filters.supplier_id} onChange={(e) => setFilters({ ...filters, supplier_id: e.target.value })}>
              <option value="">All</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="toolbar">
        <div className="tile" style={{ margin: 0 }}>
          <div className="tile-label">Total (filtered)</div>
          <div className="tile-value">{formatMoney(totalAmount)}</div>
        </div>
        <ExportButtons
          title="Purchase Invoices"
          filename="purchase_invoices"
          columns={[
            { key: 'invoice_number', label: 'Invoice #' },
            { key: 'date', label: 'Date' },
            { key: 'supplier', label: 'Supplier' },
            { key: 'subtotal', label: 'Subtotal' },
            { key: 'gst_amount', label: 'GST' },
            { key: 'total', label: 'Total' },
            { key: 'payment_type', label: 'Payment' },
          ]}
          rows={exportRows}
        />
      </div>

      <div className="card">
        {error && <div className="inline-error">{error}</div>}
        {loading ? (
          <p className="muted">Loading…</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th></th>
                <th></th>
                <th>Invoice #</th>
                <th>Date</th>
                <th>Supplier</th>
                <th>Subtotal</th>
                <th>GST</th>
                <th>Total</th>
                <th>Payment</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const status = paymentStatus(r)
                return (
                <Fragment key={r.id}>
                  <tr>
                    <td>
                      {isAdmin && (
                        <button className="btn-danger" disabled={deletingId === r.id} onClick={() => handleDelete(r)}>
                          {deletingId === r.id ? 'Deleting…' : 'Delete'}
                        </button>
                      )}
                    </td>
                    <td>
                      <button className="btn-secondary" onClick={() => toggleExpand(r.id)}>
                        {expandedId === r.id ? '−' : '+'}
                      </button>
                    </td>
                    <td>{r.invoice_number}</td>
                    <td>{formatDate(r.date)}</td>
                    <td>{r.suppliers?.name}</td>
                    <td>{formatMoney(r.subtotal)}</td>
                    <td>{formatMoney(r.gst_amount)}</td>
                    <td>{formatMoney(r.total)}</td>
                    <td>
                      <span className={r.payment_type === 'Credit' ? 'tag tag-warning' : 'tag tag-success'}>
                        {r.payment_type}
                      </span>
                    </td>
                    <td>
                      <span
                        className={
                          status === 'Paid' ? 'tag tag-success' : status === 'Partial' ? 'tag tag-warning' : 'tag tag-danger'
                        }
                      >
                        {status}
                      </span>
                      {r.payment_type === 'Credit' && status !== 'Paid' && (
                        <>
                          {' '}
                          <button className="btn-secondary" onClick={() => openPayment(r)}>
                            Make Payment
                          </button>
                        </>
                      )}
                    </td>
                    <td></td>
                  </tr>
                  {payingId === r.id && (
                    <tr>
                      <td></td>
                      <td></td>
                      <td colSpan={9}>
                        <div className="form-grid" style={{ alignItems: 'end' }}>
                          <label>
                            Amount (SGD)
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={paymentForm.amount}
                              onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })}
                            />
                          </label>
                          <label>
                            Payment Type
                            <select
                              value={paymentForm.payment_type}
                              onChange={(e) => setPaymentForm({ ...paymentForm, payment_type: e.target.value })}
                            >
                              <option>Cash</option>
                              <option>Bank</option>
                            </select>
                          </label>
                          <label>
                            Date
                            <input
                              type="date"
                              value={paymentForm.date}
                              onChange={(e) => setPaymentForm({ ...paymentForm, date: e.target.value })}
                            />
                          </label>
                          <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <button className="btn" disabled={payingSaving} onClick={() => handleRecordPayment(r)}>
                              {payingSaving ? 'Saving…' : 'Record Payment'}
                            </button>
                            <button className="btn-secondary" onClick={() => setPayingId(null)}>
                              Cancel
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                  {expandedId === r.id && (
                    <tr>
                      <td></td>
                      <td></td>
                      <td colSpan={9}>
                        <table className="data-table">
                          <thead>
                            <tr>
                              <th>Item</th>
                              <th>Qty</th>
                              <th>Unit</th>
                              <th>Rate</th>
                              <th>Discount</th>
                              <th>GST</th>
                              <th>Amount</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(itemsByInvoice[r.id] ?? []).map((it) => (
                              <tr key={it.id}>
                                <td>{it.products?.name ?? '—'}</td>
                                <td>{it.quantity}</td>
                                <td>{it.unit}</td>
                                <td>{formatMoney(it.rate)}</td>
                                <td>{formatMoney(it.discount)}</td>
                                <td>{it.gst_applicable ? formatMoney(it.gst_amount) : '—'}</td>
                                <td>{formatMoney(it.amount)}</td>
                              </tr>
                            ))}
                            {(itemsByInvoice[r.id] ?? []).length === 0 && (
                              <tr>
                                <td colSpan={7} className="muted">
                                  No line items.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
                )
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={11} className="muted">
                    No purchase invoices in this range.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
