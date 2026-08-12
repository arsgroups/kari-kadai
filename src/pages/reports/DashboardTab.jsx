import { useEffect, useState } from 'react'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts'
import { supabase } from '../../lib/supabaseClient'
import { formatMoney, toISODate } from '../../lib/format'

function daysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d
}

function startOfWeek(date) {
  const d = new Date(date)
  const day = (d.getDay() + 6) % 7 // Monday = 0
  d.setDate(d.getDate() - day)
  d.setHours(0, 0, 0, 0)
  return d
}

function rangeSum(rows, from, to) {
  return rows
    .filter((r) => r.date >= toISODate(from) && r.date <= toISODate(to))
    .reduce((sum, r) => sum + r.total, 0)
}

export default function DashboardTab() {
  const [loading, setLoading] = useState(true)
  const [dailySales, setDailySales] = useState([])
  const [productSales, setProductSales] = useState([])
  const [channelSales, setChannelSales] = useState([])
  const [comparison, setComparison] = useState(null)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    const since = daysAgo(60)
    const [{ data: sales }, { data: purchases }, { data: saleItems }] = await Promise.all([
      supabase.from('sale_invoices').select('date, total, channel').gte('date', toISODate(since)),
      supabase.from('purchase_invoices').select('date, total').gte('date', toISODate(since)),
      supabase
        .from('sale_invoice_items')
        .select('amount, gst_amount, gst_applicable, products(name), sale_invoices!inner(date)')
        .gte('sale_invoices.date', toISODate(since)),
    ])

    const salesRows = sales ?? []
    const purchaseRows = purchases ?? []
    const saleItemRows = saleItems ?? []

    // Daily trend, last 30 days
    const byDay = {}
    for (let i = 29; i >= 0; i--) {
      const key = toISODate(daysAgo(i))
      byDay[key] = { date: key.slice(5), sales: 0, purchases: 0 }
    }
    salesRows.forEach((s) => {
      if (byDay[s.date]) byDay[s.date].sales += s.total
    })
    purchaseRows.forEach((p) => {
      if (byDay[p.date]) byDay[p.date].purchases += p.total
    })
    setDailySales(Object.values(byDay))

    // Current month product breakdown (from line items, since a product isn't on the invoice itself)
    const monthStart = toISODate(new Date(new Date().getFullYear(), new Date().getMonth(), 1))
    const byProduct = {}
    saleItemRows
      .filter((it) => it.sale_invoices?.date >= monthStart)
      .forEach((it) => {
        const name = it.products?.name ?? 'Unknown'
        const lineTotal = it.amount + (it.gst_applicable ? it.gst_amount : 0)
        byProduct[name] = (byProduct[name] ?? 0) + lineTotal
      })
    setProductSales(Object.entries(byProduct).map(([name, total]) => ({ name, total })))

    const byChannel = {}
    salesRows
      .filter((s) => s.date >= monthStart)
      .forEach((s) => {
        byChannel[s.channel] = (byChannel[s.channel] ?? 0) + s.total
      })
    setChannelSales(Object.entries(byChannel).map(([name, total]) => ({ name, total })))

    // Period comparisons
    const today = new Date()
    const thisWeekStart = startOfWeek(today)
    const lastWeekStart = new Date(thisWeekStart)
    lastWeekStart.setDate(lastWeekStart.getDate() - 7)
    const lastWeekEnd = new Date(thisWeekStart)
    lastWeekEnd.setDate(lastWeekEnd.getDate() - 1)

    const thisMonthStart = new Date(today.getFullYear(), today.getMonth(), 1)
    const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1)
    const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0)

    setComparison({
      thisWeek: rangeSum(salesRows, thisWeekStart, today),
      lastWeek: rangeSum(salesRows, lastWeekStart, lastWeekEnd),
      thisMonth: rangeSum(salesRows, thisMonthStart, today),
      lastMonth: rangeSum(salesRows, lastMonthStart, lastMonthEnd),
      thisWeekPurchases: rangeSum(purchaseRows, thisWeekStart, today),
      lastWeekPurchases: rangeSum(purchaseRows, lastWeekStart, lastWeekEnd),
      thisMonthPurchases: rangeSum(purchaseRows, thisMonthStart, today),
      lastMonthPurchases: rangeSum(purchaseRows, lastMonthStart, lastMonthEnd),
    })

    setLoading(false)
  }

  function pctChange(curr, prev) {
    if (!prev) return curr > 0 ? '+100%' : '0%'
    const pct = ((curr - prev) / prev) * 100
    return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`
  }

  if (loading) return <p className="muted">Loading…</p>

  return (
    <div>
      <div className="card">
        <h3>Sales & Purchases Trend (last 30 days)</h3>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={dailySales}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" fontSize={11} />
            <YAxis fontSize={11} />
            <Tooltip formatter={(v) => formatMoney(v)} />
            <Legend />
            <Line type="monotone" dataKey="sales" stroke="#7a1f1f" name="Sales" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="purchases" stroke="#b7791f" name="Purchases" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="report-grid-2col">
        <div className="card">
          <h3>Sales by Product (this month)</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={productSales}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" fontSize={11} />
              <YAxis fontSize={11} />
              <Tooltip formatter={(v) => formatMoney(v)} />
              <Bar dataKey="total" fill="#7a1f1f" />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="card">
          <h3>Sales by Channel (this month)</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={channelSales}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" fontSize={11} />
              <YAxis fontSize={11} />
              <Tooltip formatter={(v) => formatMoney(v)} />
              <Bar dataKey="total" fill="#b7791f" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {comparison && (
        <div className="card">
          <h3>Period Comparison</h3>
          <table className="data-table">
            <thead>
              <tr>
                <th></th>
                <th>This Week</th>
                <th>Last Week</th>
                <th>Change</th>
                <th>This Month</th>
                <th>Last Month</th>
                <th>Change</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Sales</td>
                <td>{formatMoney(comparison.thisWeek)}</td>
                <td>{formatMoney(comparison.lastWeek)}</td>
                <td>{pctChange(comparison.thisWeek, comparison.lastWeek)}</td>
                <td>{formatMoney(comparison.thisMonth)}</td>
                <td>{formatMoney(comparison.lastMonth)}</td>
                <td>{pctChange(comparison.thisMonth, comparison.lastMonth)}</td>
              </tr>
              <tr>
                <td>Purchases</td>
                <td>{formatMoney(comparison.thisWeekPurchases)}</td>
                <td>{formatMoney(comparison.lastWeekPurchases)}</td>
                <td>{pctChange(comparison.thisWeekPurchases, comparison.lastWeekPurchases)}</td>
                <td>{formatMoney(comparison.thisMonthPurchases)}</td>
                <td>{formatMoney(comparison.lastMonthPurchases)}</td>
                <td>{pctChange(comparison.thisMonthPurchases, comparison.lastMonthPurchases)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
