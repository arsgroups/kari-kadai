import { Fragment, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { formatDate, formatMoney, toISODate } from '../../lib/format'
import ExportButtons from '../../components/ExportButtons'

function firstOfMonth() {
  const d = new Date()
  return toISODate(new Date(d.getFullYear(), d.getMonth(), 1))
}

const emptyFilters = { from: firstOfMonth(), to: toISODate(), supplier_id: '', source: '' }

export default function PurchaseInvoicesListTab() {
  const [rows, setRows] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filters, setFilters] = useState(emptyFilters)
  const [expandedId, setExpandedId] = useState(null)
  const [itemsByInvoice, setItemsByInvoice] = useState({})
  const [deletingId, setDeletingId] = useState(null)

  useEffect(() => {
    supabase.from('suppliers').select('id, name').order('name').then(({ data }) => setSuppliers(data ?? []))
  }, [])

  async function load() {
    setLoading(true)
    setError('')
    let query = supabase
      .from('purchase_invoices')
      .select('id, invoice_number, date, subtotal, gst_amount, total, payment_type, source, note, suppliers(name)')
      .gte('date', filters.from)
      .lte('date', filters.to)
      .order('date', { ascending: false })

    if (filters.supplier_id) query = query.eq('supplier_id', filters.supplier_id)
    if (filters.source) query = query.eq('source', filters.source)

    const { data, error } = await query.limit(500)
    if (error) setError(error.message)
    else setRows(data ?? [])
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

  const totalAmount = rows.reduce((sum, r) => sum + r.total, 0)

  const exportRows = rows.map((r) => ({
    invoice_number: r.invoice_number,
    date: formatDate(r.date),
    supplier: r.suppliers?.name,
    subtotal: r.subtotal,
    gst_amount: r.gst_amount,
    total: r.total,
    payment_type: r.payment_type,
    source: r.source,
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
          <label>
            Source
            <select value={filters.source} onChange={(e) => setFilters({ ...filters, source: e.target.value })}>
              <option value="">All</option>
              <option value="manual">Manually entered</option>
              <option value="imported">Imported from accounting app</option>
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
            { key: 'source', label: 'Source' },
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
                <th>Supplier</th>
                <th>Subtotal</th>
                <th>GST</th>
                <th>Total</th>
                <th>Payment</th>
                <th>Source</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Fragment key={r.id}>
                  <tr>
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
                      <span className={r.source === 'imported' ? 'tag tag-muted' : 'tag tag-success'}>
                        {r.source === 'imported' ? 'Imported' : 'Manual'}
                      </span>
                    </td>
                    <td>
                      <button className="btn-danger" disabled={deletingId === r.id} onClick={() => handleDelete(r)}>
                        {deletingId === r.id ? 'Deleting…' : 'Delete'}
                      </button>
                    </td>
                  </tr>
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
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={10} className="muted">
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
