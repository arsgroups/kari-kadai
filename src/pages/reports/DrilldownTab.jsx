import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { formatDate, formatMoney, toISODate } from '../../lib/format'
import ExportButtons from '../../components/ExportButtons'

function firstOfMonth() {
  const d = new Date()
  return toISODate(new Date(d.getFullYear(), d.getMonth(), 1))
}

export default function DrilldownTab() {
  const [reportType, setReportType] = useState('sales')
  const [from, setFrom] = useState(firstOfMonth())
  const [to, setTo] = useState(toISODate())
  const [productId, setProductId] = useState('')
  const [channel, setChannel] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [categoryId, setCategoryId] = useState('')

  const [products, setProducts] = useState([])
  const [customers, setCustomers] = useState([])
  const [categories, setCategories] = useState([])
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('products').select('id, name').order('name').then(({ data }) => setProducts(data ?? []))
    supabase.from('customers').select('id, name').order('name').then(({ data }) => setCustomers(data ?? []))
    supabase
      .from('expense_categories')
      .select('id, name')
      .order('name')
      .then(({ data }) => setCategories(data ?? []))
  }, [])

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportType, from, to, productId, channel, customerId, categoryId])

  async function load() {
    setLoading(true)
    if (reportType === 'sales') {
      let q = supabase
        .from('sales')
        .select('date, quantity, total, channel, payment_type, products(name), customers(name)')
        .gte('date', from)
        .lte('date', to)
      if (productId) q = q.eq('product_id', productId)
      if (channel) q = q.eq('channel', channel)
      if (customerId) q = q.eq('customer_id', customerId)
      const { data } = await q.order('date', { ascending: false }).limit(500)
      setRows(
        (data ?? []).map((r) => ({
          date: formatDate(r.date),
          product: r.products?.name,
          quantity: r.quantity,
          total: r.total,
          channel: r.channel,
          customer: r.customers?.name ?? '',
          payment_type: r.payment_type,
        }))
      )
    } else if (reportType === 'purchases') {
      // One row per purchase invoice line item (a single invoice can span multiple products).
      let q = supabase
        .from('purchase_invoice_items')
        .select(
          'amount, gst_amount, gst_applicable, products(name), purchase_invoices!inner(date, payment_type, suppliers(name))'
        )
        .gte('purchase_invoices.date', from)
        .lte('purchase_invoices.date', to)
      if (productId) q = q.eq('product_id', productId)
      const { data } = await q.limit(500)
      setRows(
        (data ?? []).map((r) => ({
          date: formatDate(r.purchase_invoices?.date),
          product: r.products?.name ?? '',
          amount_before_gst: r.amount,
          gst_amount: r.gst_applicable ? r.gst_amount : 0,
          total: r.amount + (r.gst_applicable ? r.gst_amount : 0),
          supplier: r.purchase_invoices?.suppliers?.name,
          payment_type: r.purchase_invoices?.payment_type,
        }))
      )
    } else {
      let q = supabase
        .from('monthly_expenses')
        .select('month, amount, note, expense_categories(name)')
        .gte('month', from.slice(0, 7) + '-01')
        .lte('month', to.slice(0, 7) + '-01')
      if (categoryId) q = q.eq('category_id', categoryId)
      const { data } = await q.order('month', { ascending: false })
      setRows(
        (data ?? []).map((r) => ({
          month: r.month?.slice(0, 7),
          category: r.expense_categories?.name,
          amount: r.amount,
          note: r.note,
        }))
      )
    }
    setLoading(false)
  }

  const columnSets = {
    sales: [
      { key: 'date', label: 'Date' },
      { key: 'product', label: 'Product' },
      { key: 'quantity', label: 'Qty' },
      { key: 'total', label: 'Total' },
      { key: 'channel', label: 'Channel' },
      { key: 'customer', label: 'Customer' },
      { key: 'payment_type', label: 'Payment' },
    ],
    purchases: [
      { key: 'date', label: 'Date' },
      { key: 'supplier', label: 'Supplier' },
      { key: 'product', label: 'Product' },
      { key: 'amount_before_gst', label: 'Amount (excl. GST)' },
      { key: 'gst_amount', label: 'GST' },
      { key: 'total', label: 'Total' },
      { key: 'payment_type', label: 'Payment' },
    ],
    expenses: [
      { key: 'month', label: 'Month' },
      { key: 'category', label: 'Category' },
      { key: 'amount', label: 'Amount' },
      { key: 'note', label: 'Note' },
    ],
  }
  const columns = columnSets[reportType]
  const amountKey = reportType === 'expenses' ? 'amount' : 'total'
  const totalAmount = rows.reduce((sum, r) => sum + (Number(r[amountKey]) || 0), 0)

  return (
    <div>
      <div className="card">
        <div className="form-grid">
          <label>
            Report Type
            <select value={reportType} onChange={(e) => setReportType(e.target.value)}>
              <option value="sales">Sales</option>
              <option value="purchases">Purchases</option>
              <option value="expenses">Monthly Expenses</option>
            </select>
          </label>
          <label>
            From
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            To
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          {reportType !== 'expenses' && (
            <label>
              Product
              <select value={productId} onChange={(e) => setProductId(e.target.value)}>
                <option value="">All</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {reportType === 'sales' && (
            <>
              <label>
                Channel
                <select value={channel} onChange={(e) => setChannel(e.target.value)}>
                  <option value="">All</option>
                  <option>Counter</option>
                  <option>Restaurant</option>
                  <option>Home Delivery</option>
                </select>
              </label>
              <label>
                Customer
                <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                  <option value="">All</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          {reportType === 'expenses' && (
            <label>
              Category
              <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">All</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </div>

      <div className="toolbar">
        <div className="tile" style={{ margin: 0 }}>
          <div className="tile-label">Total (filtered)</div>
          <div className="tile-value">{formatMoney(totalAmount)}</div>
        </div>
        <ExportButtons title={`Drilldown: ${reportType}`} filename={`drilldown_${reportType}`} columns={columns} rows={rows} />
      </div>

      <div className="card">
        {loading ? (
          <p className="muted">Loading…</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.key}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  {columns.map((c) => (
                    <td key={c.key}>
                      {['total', 'amount', 'amount_before_gst', 'gst_amount'].includes(c.key)
                        ? formatMoney(r[c.key])
                        : r[c.key]}
                    </td>
                  ))}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={columns.length} className="muted">
                    No results for this filter.
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
