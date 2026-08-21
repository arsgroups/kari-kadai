import { Fragment, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { formatDate, formatMoney, toISODate } from '../../lib/format'
import ExportButtons from '../../components/ExportButtons'
import SaleInvoiceView from './SaleInvoiceView'

function firstOfMonth() {
  const d = new Date()
  return toISODate(new Date(d.getFullYear(), d.getMonth(), 1))
}

const emptyFilters = {
  from: firstOfMonth(),
  to: toISODate(),
  channel: '',
  customer_id: '',
  payment_type: '',
  payment_status: '',
}

export default function SaleInvoicesListTab() {
  const [rows, setRows] = useState([])
  const [customers, setCustomers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filters, setFilters] = useState(emptyFilters)
  const [expandedId, setExpandedId] = useState(null)
  const [itemsByInvoice, setItemsByInvoice] = useState({})
  const [viewingInvoiceId, setViewingInvoiceId] = useState(null)
  const [extraPaidByInvoice, setExtraPaidByInvoice] = useState({})
  const [payingId, setPayingId] = useState(null)
  const [paymentForm, setPaymentForm] = useState({ amount: '', payment_type: 'Cash', date: toISODate() })
  const [payingSaving, setPayingSaving] = useState(false)
  const [costByProduct, setCostByProduct] = useState({})
  const [belowCostInvoices, setBelowCostInvoices] = useState(new Set())

  useEffect(() => {
    supabase.from('customers').select('id, name').order('name').then(({ data }) => setCustomers(data ?? []))
    supabase
      .from('products')
      .select('id, average_cost, default_purchase_price')
      .then(({ data }) => {
        const map = {}
        ;(data ?? []).forEach((p) => {
          map[p.id] = Number(p.average_cost) || Number(p.default_purchase_price) || 0
        })
        setCostByProduct(map)
      })
  }, [])

  async function load() {
    setLoading(true)
    setError('')
    let query = supabase
      .from('sale_invoices')
      .select(
        'id, invoice_number, date, channel, customer_id, subtotal, gst_amount, total, paid_amount, balance, payment_type, customers(name)'
      )
      .gte('date', filters.from)
      .lte('date', filters.to)
      .order('date', { ascending: false })

    if (filters.channel) query = query.eq('channel', filters.channel)
    if (filters.customer_id) query = query.eq('customer_id', filters.customer_id)
    if (filters.payment_type) query = query.eq('payment_type', filters.payment_type)

    const { data, error } = await query.limit(500)
    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }
    setRows(data ?? [])

    const invoiceIds = (data ?? []).map((r) => r.id)
    if (invoiceIds.length) {
      const [{ data: paymentRows }, { data: itemRows }] = await Promise.all([
        supabase.from('customer_payments').select('invoice_id, amount').in('invoice_id', invoiceIds),
        supabase.from('sale_invoice_items').select('sale_invoice_id, product_id, rate').in('sale_invoice_id', invoiceIds),
      ])
      const paidMap = {}
      ;(paymentRows ?? []).forEach((p) => {
        paidMap[p.invoice_id] = (paidMap[p.invoice_id] ?? 0) + p.amount
      })
      setExtraPaidByInvoice(paidMap)

      const belowCost = new Set()
      ;(itemRows ?? []).forEach((it) => {
        const cost = costByProduct[it.product_id] ?? 0
        if (cost > 0 && Number(it.rate) > 0 && Number(it.rate) < cost) belowCost.add(it.sale_invoice_id)
      })
      setBelowCostInvoices(belowCost)
    } else {
      setExtraPaidByInvoice({})
      setBelowCostInvoices(new Set())
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, costByProduct])

  async function toggleExpand(invoiceId) {
    if (expandedId === invoiceId) {
      setExpandedId(null)
      return
    }
    setExpandedId(invoiceId)
    if (!itemsByInvoice[invoiceId]) {
      const { data } = await supabase
        .from('sale_invoice_items')
        .select('id, quantity, unit, rate, discount, gst_applicable, gst_amount, amount, products(name)')
        .eq('sale_invoice_id', invoiceId)
      setItemsByInvoice({ ...itemsByInvoice, [invoiceId]: data ?? [] })
    }
  }

  function outstandingFor(invoice) {
    return Math.max(invoice.balance - (extraPaidByInvoice[invoice.id] ?? 0), 0)
  }

  function paymentStatus(invoice) {
    if (invoice.payment_type !== 'Credit') return 'Paid'
    const outstanding = outstandingFor(invoice)
    if (outstanding <= 0) return 'Paid'
    if (outstanding < invoice.total) return 'Partial'
    return 'Pending'
  }

  function openPayment(invoice) {
    setPayingId(invoice.id)
    setPaymentForm({ amount: String(outstandingFor(invoice)), payment_type: 'Cash', date: toISODate() })
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
    const { error: payError } = await supabase.from('customer_payments').insert({
      customer_id: invoice.customer_id,
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

  if (viewingInvoiceId) {
    return (
      <SaleInvoiceView
        invoiceId={viewingInvoiceId}
        onClose={() => setViewingInvoiceId(null)}
        onDeleted={() => {
          setViewingInvoiceId(null)
          setItemsByInvoice({})
          load()
        }}
      />
    )
  }

  const filteredRows = filters.payment_status
    ? rows.filter((r) => paymentStatus(r) === filters.payment_status)
    : rows

  const totalAmount = filteredRows.reduce((sum, r) => sum + r.total, 0)
  const totalOutstanding = filteredRows.reduce((sum, r) => sum + outstandingFor(r), 0)

  const exportRows = filteredRows.map((r) => ({
    invoice_number: r.invoice_number,
    date: formatDate(r.date),
    channel: r.channel,
    customer: r.customers?.name ?? '',
    subtotal: r.subtotal,
    gst_amount: r.gst_amount,
    total: r.total,
    paid_amount: r.paid_amount,
    balance: r.balance,
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
            Channel
            <select value={filters.channel} onChange={(e) => setFilters({ ...filters, channel: e.target.value })}>
              <option value="">All</option>
              <option>Counter</option>
              <option>Restaurant</option>
              <option>Home Delivery</option>
            </select>
          </label>
          <label>
            Customer
            <select value={filters.customer_id} onChange={(e) => setFilters({ ...filters, customer_id: e.target.value })}>
              <option value="">All</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Payment
            <select value={filters.payment_type} onChange={(e) => setFilters({ ...filters, payment_type: e.target.value })}>
              <option value="">All</option>
              <option>Cash</option>
              <option>Bank</option>
              <option>Credit</option>
            </select>
          </label>
          <label>
            Payment Status
            <select
              value={filters.payment_status}
              onChange={(e) => setFilters({ ...filters, payment_status: e.target.value })}
            >
              <option value="">All</option>
              <option>Paid</option>
              <option>Partial</option>
              <option>Pending</option>
            </select>
          </label>
        </div>
      </div>

      <div className="toolbar">
        <div className="tile" style={{ margin: 0 }}>
          <div className="tile-label">Total (filtered)</div>
          <div className="tile-value">{formatMoney(totalAmount)}</div>
        </div>
        <div className="tile" style={{ margin: 0 }}>
          <div className="tile-label">Outstanding (filtered)</div>
          <div className="tile-value">{formatMoney(totalOutstanding)}</div>
        </div>
        <ExportButtons
          title="Sale Invoices"
          filename="sale_invoices"
          columns={[
            { key: 'invoice_number', label: 'Invoice #' },
            { key: 'date', label: 'Date' },
            { key: 'channel', label: 'Channel' },
            { key: 'customer', label: 'Customer' },
            { key: 'subtotal', label: 'Subtotal', money: true },
            { key: 'gst_amount', label: 'GST', money: true },
            { key: 'total', label: 'Total', money: true },
            { key: 'paid_amount', label: 'Paid', money: true },
            { key: 'balance', label: 'Balance', money: true },
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
                <th>Invoice #</th>
                <th>Date</th>
                <th>Channel</th>
                <th>Customer</th>
                <th>Total</th>
                <th>Balance</th>
                <th>Payment</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((r) => {
                const status = paymentStatus(r)
                const outstanding = outstandingFor(r)
                const belowCost = belowCostInvoices.has(r.id)
                return (
                <Fragment key={r.id}>
                  <tr style={belowCost ? { background: '#fbe9e7' } : undefined}>
                    <td>
                      <button className="btn-secondary" onClick={() => toggleExpand(r.id)}>
                        {expandedId === r.id ? '−' : '+'}
                      </button>
                    </td>
                    <td>
                      {r.invoice_number}
                      {belowCost && (
                        <>
                          {' '}
                          <span className="tag tag-danger">Below Cost</span>
                        </>
                      )}
                    </td>
                    <td>{formatDate(r.date)}</td>
                    <td>{r.channel}</td>
                    <td>{r.customers?.name ?? '—'}</td>
                    <td>{formatMoney(r.total)}</td>
                    <td>
                      <span className={outstanding > 0 ? 'tag tag-warning' : 'tag tag-success'}>
                        {formatMoney(outstanding)}
                      </span>
                    </td>
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
                    <td>
                      <button className="btn-secondary" onClick={() => setViewingInvoiceId(r.id)}>
                        View / Print
                      </button>
                    </td>
                  </tr>
                  {payingId === r.id && (
                    <tr>
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
              {filteredRows.length === 0 && (
                <tr>
                  <td colSpan={10} className="muted">
                    No sale invoices in this range.
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
