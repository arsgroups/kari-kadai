import { useEffect, useState } from 'react'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts'
import { supabase } from '../../lib/supabaseClient'
import { formatMoney, toISODate } from '../../lib/format'
import { round2 } from '../../lib/gst'
import ExportButtons from '../../components/ExportButtons'
import ReportPrintHeader from '../../components/ReportPrintHeader'

const CHANNELS = ['Restaurant', 'Home Delivery', 'Counter']
const CHANNEL_COLORS = { Restaurant: '#7a1f1f', 'Home Delivery': '#b7791f', Counter: '#1a7f37' }

function firstOfMonth() {
  const d = new Date()
  return toISODate(new Date(d.getFullYear(), d.getMonth(), 1))
}

export default function ChannelMarginTab() {
  const [from, setFrom] = useState(firstOfMonth())
  const [to, setTo] = useState(toISODate())
  const [loading, setLoading] = useState(true)
  const [channelRows, setChannelRows] = useState([])
  const [topItemsByChannel, setTopItemsByChannel] = useState({})
  const [trendData, setTrendData] = useState([])

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to])

  async function load() {
    setLoading(true)
    const [{ data: invoiceRows }, { data: itemRows }] = await Promise.all([
      supabase.from('sale_invoices').select('date, channel, subtotal').gte('date', from).lte('date', to),
      supabase
        .from('sale_invoice_items')
        .select('quantity, amount, unit_cost, products(name), sale_invoices!inner(date, channel)')
        .gte('sale_invoices.date', from)
        .lte('sale_invoices.date', to),
    ])

    const byChannel = Object.fromEntries(CHANNELS.map((c) => [c, { revenue: 0, cost: 0, hasCost: false }]))
    ;(invoiceRows ?? []).forEach((inv) => {
      if (byChannel[inv.channel]) byChannel[inv.channel].revenue += inv.subtotal
    })

    const itemsByChannel = Object.fromEntries(CHANNELS.map((c) => [c, {}]))
    ;(itemRows ?? []).forEach((it) => {
      const channel = it.sale_invoices?.channel
      if (!byChannel[channel]) return
      if (it.unit_cost != null) {
        byChannel[channel].cost += it.quantity * it.unit_cost
        byChannel[channel].hasCost = true
      }
      const name = it.products?.name ?? 'Unknown'
      itemsByChannel[channel][name] = (itemsByChannel[channel][name] ?? 0) + it.amount
    })

    setChannelRows(
      CHANNELS.map((c) => {
        const r = byChannel[c]
        const revenue = round2(r.revenue)
        const cost = round2(r.cost)
        const margin = round2(revenue - cost)
        return {
          channel: c,
          revenue,
          cost,
          margin,
          marginPct: revenue > 0 ? round2((margin / revenue) * 100) : 0,
          hasCost: r.hasCost,
        }
      })
    )

    const topItems = {}
    CHANNELS.forEach((c) => {
      topItems[c] = Object.entries(itemsByChannel[c])
        .map(([name, revenue]) => ({ name, revenue: round2(revenue) }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 5)
    })
    setTopItemsByChannel(topItems)

    const byDay = {}
    ;(invoiceRows ?? []).forEach((inv) => {
      if (!byDay[inv.date]) byDay[inv.date] = { date: inv.date.slice(5) }
      byDay[inv.date][inv.channel] = round2((byDay[inv.date][inv.channel] ?? 0) + inv.subtotal)
    })
    setTrendData(Object.keys(byDay).sort().map((d) => byDay[d]))

    setLoading(false)
  }

  const exportRows = channelRows.map((r) => ({
    channel: r.channel,
    revenue: r.revenue,
    cost: r.hasCost ? r.cost : '',
    margin: r.hasCost ? r.margin : '',
    margin_pct: r.hasCost ? `${r.marginPct}%` : '',
  }))

  return (
    <div>
      <ReportPrintHeader title="Channel Sales & Margin" />
      <div className="card">
        <div className="form-grid">
          <label>
            From
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            To
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
        <p className="muted" style={{ fontSize: '0.8rem', marginTop: '0.75rem', marginBottom: 0 }}>
          Revenue is each channel's invoice subtotal (net, matches P&amp;L). Cost/Margin use each sold
          item's average cost at time of sale, so they only reflect itemized invoices — a channel with
          historical/backfilled totals (no line items) will show its full Revenue but an understated Cost,
          overstating Margin for that portion.
        </p>
      </div>

      <div className="toolbar">
        <ExportButtons
          title={`Channel Sales & Margin: ${from} to ${to}`}
          filename="channel_sales_margin"
          columns={[
            { key: 'channel', label: 'Channel' },
            { key: 'revenue', label: 'Revenue', money: true },
            { key: 'cost', label: 'Cost', money: true },
            { key: 'margin', label: 'Margin', money: true },
            { key: 'margin_pct', label: 'Margin %' },
          ]}
          rows={exportRows}
        />
      </div>

      {loading ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <div className="card">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Channel</th>
                  <th>Revenue</th>
                  <th>Cost</th>
                  <th>Margin</th>
                  <th>Margin %</th>
                </tr>
              </thead>
              <tbody>
                {channelRows.map((r) => (
                  <tr key={r.channel}>
                    <td>{r.channel}</td>
                    <td>{formatMoney(r.revenue)}</td>
                    <td>{r.hasCost ? formatMoney(r.cost) : '—'}</td>
                    <td>
                      {r.hasCost ? (
                        <span className={r.margin >= 0 ? 'tag tag-success' : 'tag tag-danger'}>
                          {formatMoney(r.margin)}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>{r.hasCost ? `${r.marginPct}%` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card">
            <h3>Sales Trend by Channel</h3>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip formatter={(v) => formatMoney(v)} />
                <Legend />
                {CHANNELS.map((c) => (
                  <Line
                    key={c}
                    type="monotone"
                    dataKey={c}
                    stroke={CHANNEL_COLORS[c]}
                    name={c}
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="report-grid-2col">
            {CHANNELS.map((c) => (
              <div className="card" key={c}>
                <h3>Top Items — {c}</h3>
                <p className="muted" style={{ fontSize: '0.8rem', marginTop: '-0.5rem' }}>
                  Where {c.toLowerCase()} revenue concentrates (top 5 by revenue in range).
                </p>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(topItemsByChannel[c] ?? []).map((it) => (
                      <tr key={it.name}>
                        <td>{it.name}</td>
                        <td>{formatMoney(it.revenue)}</td>
                      </tr>
                    ))}
                    {(topItemsByChannel[c] ?? []).length === 0 && (
                      <tr>
                        <td colSpan={2} className="muted">
                          No itemized sales in this range.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
