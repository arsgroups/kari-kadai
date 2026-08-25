import { Fragment, useEffect, useState } from 'react'
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
  const [nonItemized, setNonItemized] = useState(null)
  const [yieldGroupRows, setYieldGroupRows] = useState([])

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to])

  async function load() {
    setLoading(true)
    const [{ data: invoiceRows }, { data: itemRows }, { data: purchaseRows }, { data: yieldConfigs }] =
      await Promise.all([
        supabase.from('sale_invoices').select('date, channel, subtotal').gte('date', from).lte('date', to),
        supabase
          .from('sale_invoice_items')
          .select('product_id, quantity, amount, unit_cost, products(name), sale_invoices!inner(date, channel)')
          .gte('sale_invoices.date', from)
          .lte('sale_invoices.date', to),
        supabase.from('purchase_invoices').select('date, total').gte('date', from).lte('date', to),
        supabase
          .from('yield_configurations')
          .select(
            'id, parent_product_id, products(name), yield_configuration_items(child_product_id, is_active, products(name))'
          )
          .eq('is_active', true),
      ])

    // Days with no line items at all (e.g. Historical Data Entry backfill)
    // have no per-item cost data -- keep them out of the itemized channel
    // breakdown entirely (previously their full revenue counted with ~zero
    // cost, inflating margin toward 100%) and instead net them separately
    // below as one combined Sales - Purchases figure for that period.
    const itemizedDates = new Set((itemRows ?? []).map((it) => it.sale_invoices?.date).filter(Boolean))

    const byChannel = Object.fromEntries(CHANNELS.map((c) => [c, { revenue: 0, cost: 0, hasCost: false }]))
    ;(invoiceRows ?? []).forEach((inv) => {
      if (!itemizedDates.has(inv.date)) return
      if (byChannel[inv.channel]) byChannel[inv.channel].revenue += inv.subtotal
    })

    const itemsByChannel = Object.fromEntries(CHANNELS.map((c) => [c, {}]))
    const revenueByProduct = {}
    const revenueByProductChannel = {}
    ;(itemRows ?? []).forEach((it) => {
      revenueByProduct[it.product_id] = (revenueByProduct[it.product_id] ?? 0) + it.amount
      const channel = it.sale_invoices?.channel
      if (channel) {
        if (!revenueByProductChannel[it.product_id]) revenueByProductChannel[it.product_id] = {}
        revenueByProductChannel[it.product_id][channel] =
          (revenueByProductChannel[it.product_id][channel] ?? 0) + it.amount
      }
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

    // Non-itemized days: netted as Sales - Purchases for that same set of
    // dates, shown as one combined figure (not split by channel, since
    // purchases were never tracked per channel).
    const nonItemizedSalesRows = (invoiceRows ?? []).filter((inv) => !itemizedDates.has(inv.date))
    const nonItemizedSales = round2(nonItemizedSalesRows.reduce((sum, inv) => sum + inv.subtotal, 0))
    const nonItemizedDates = new Set(nonItemizedSalesRows.map((inv) => inv.date))
    ;(purchaseRows ?? []).forEach((p) => {
      if (!itemizedDates.has(p.date)) nonItemizedDates.add(p.date)
    })
    const nonItemizedPurchases = round2(
      (purchaseRows ?? []).filter((p) => nonItemizedDates.has(p.date)).reduce((sum, p) => sum + p.total, 0)
    )
    if (nonItemizedDates.size > 0) {
      const margin = round2(nonItemizedSales - nonItemizedPurchases)
      setNonItemized({
        days: nonItemizedDates.size,
        sales: nonItemizedSales,
        purchases: nonItemizedPurchases,
        margin,
        marginPct: nonItemizedSales > 0 ? round2((margin / nonItemizedSales) * 100) : 0,
      })
    } else {
      setNonItemized(null)
    }

    // Yield Group Margin: for a cut/yield-processed item, the child (what's
    // actually sold) never has its own purchase cost -- only the parent
    // does. With no stored yield ratio to split cost precisely per child,
    // compare the whole group instead: the parent's total purchase cost
    // this period vs. the combined revenue from all its children sold.
    const groups = (yieldConfigs ?? [])
      .map((g) => {
        const children = (g.yield_configuration_items ?? []).filter((ci) => ci.is_active)
        return {
          parentId: g.parent_product_id,
          parentName: g.products?.name ?? 'Unknown',
          childIds: children.map((ci) => ci.child_product_id),
          childNames: children.map((ci) => ci.products?.name ?? 'Unknown'),
        }
      })
      .filter((g) => g.childIds.length > 0)

    let purchasesByParent = {}
    const parentIds = groups.map((g) => g.parentId)
    if (parentIds.length > 0) {
      const { data: parentPurchases } = await supabase
        .from('purchase_invoice_items')
        .select('product_id, amount, purchase_invoices!inner(date)')
        .in('product_id', parentIds)
        .gte('purchase_invoices.date', from)
        .lte('purchase_invoices.date', to)
      ;(parentPurchases ?? []).forEach((p) => {
        purchasesByParent[p.product_id] = (purchasesByParent[p.product_id] ?? 0) + p.amount
      })
    }

    setYieldGroupRows(
      groups.map((g) => {
        const parentCost = round2(purchasesByParent[g.parentId] ?? 0)
        const childrenRevenue = round2(g.childIds.reduce((sum, id) => sum + (revenueByProduct[id] ?? 0), 0))
        const margin = round2(childrenRevenue - parentCost)
        // Parent cost isn't tracked per channel (one purchase feeds children
        // sold across all channels), so it's allocated by each channel's
        // share of this group's total children revenue -- an estimate, not
        // a directly tracked figure.
        const channelBreakdown = CHANNELS.map((c) => {
          const channelRevenue = round2(
            g.childIds.reduce((sum, id) => sum + (revenueByProductChannel[id]?.[c] ?? 0), 0)
          )
          const allocatedCost = childrenRevenue > 0 ? round2(parentCost * (channelRevenue / childrenRevenue)) : 0
          const channelMargin = round2(channelRevenue - allocatedCost)
          return {
            channel: c,
            revenue: channelRevenue,
            allocatedCost,
            margin: channelMargin,
            marginPct: channelRevenue > 0 ? round2((channelMargin / channelRevenue) * 100) : 0,
          }
        }).filter((cb) => cb.revenue > 0)
        return {
          parentName: g.parentName,
          childNames: g.childNames.join(', '),
          parentCost,
          childrenRevenue,
          margin,
          marginPct: childrenRevenue > 0 ? round2((margin / childrenRevenue) * 100) : 0,
          channelBreakdown,
        }
      })
    )

    setLoading(false)
  }

  const exportRows = channelRows.map((r) => ({
    channel: r.channel,
    revenue: r.revenue,
    cost: r.hasCost ? r.cost : '',
    margin: r.hasCost ? r.margin : '',
    margin_pct: r.hasCost ? `${r.marginPct}%` : '',
  }))

  const yieldExportRows = yieldGroupRows.flatMap((r) => [
    {
      parent: r.parentName,
      children: r.childNames,
      cost: r.parentCost,
      revenue: r.childrenRevenue,
      margin: r.margin,
      margin_pct: `${r.marginPct}%`,
    },
    ...r.channelBreakdown.map((cb) => ({
      parent: `  — ${cb.channel}`,
      children: '',
      cost: cb.allocatedCost,
      revenue: cb.revenue,
      margin: cb.margin,
      margin_pct: `${cb.marginPct}%`,
    })),
  ])

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
          item's average cost at time of sale, so this table only covers days with itemized sales — days
          with no line items (e.g. Historical Data Entry backfill) are excluded here and netted separately
          below instead, so they don't inflate this table's margin.
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
            <p className="muted" style={{ fontSize: '0.75rem', marginTop: '0.5rem', marginBottom: 0 }}>
              Only days with itemized sales are counted above.
            </p>
          </div>

          {nonItemized && (
            <div className="card">
              <h3>Days Without Item Detail</h3>
              <p className="muted" style={{ fontSize: '0.8rem', marginTop: '-0.5rem' }}>
                {nonItemized.days} day(s) in range with no line items (e.g. Historical Data Entry), netted
                as one combined Sales − Purchases figure — not split by channel, since purchases aren't
                tracked per channel.
              </p>
              <table className="data-table" style={{ maxWidth: 480 }}>
                <tbody>
                  <tr>
                    <td>Sales</td>
                    <td>{formatMoney(nonItemized.sales)}</td>
                  </tr>
                  <tr>
                    <td>Purchases</td>
                    <td>{formatMoney(nonItemized.purchases)}</td>
                  </tr>
                  <tr style={{ fontWeight: 700 }}>
                    <td>Margin</td>
                    <td>
                      <span className={nonItemized.margin >= 0 ? 'tag tag-success' : 'tag tag-danger'}>
                        {formatMoney(nonItemized.margin)} ({nonItemized.marginPct}%)
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

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

          {yieldGroupRows.length > 0 && (
            <div className="card">
              <h3>Yield Group Margin</h3>
              <p className="muted" style={{ fontSize: '0.8rem', marginTop: '-0.5rem' }}>
                For cut/processed items, only the parent (e.g. a whole chicken) is ever purchased — the
                children (e.g. breast, thigh, wing) are what's actually sold, each at its own price. There's
                no stored yield ratio to split cost precisely per child, so this compares the whole group:
                the parent's total purchase cost this period against the combined revenue from all its
                children sold. The channel rows underneath each group split that same parent cost by each
                channel's share of the group's revenue — an estimate, not a directly tracked figure, since
                purchases aren't recorded per channel.
              </p>
              <div className="toolbar" style={{ marginTop: 0 }}>
                <ExportButtons
                  title={`Yield Group Margin: ${from} to ${to}`}
                  filename="yield_group_margin"
                  columns={[
                    { key: 'parent', label: 'Parent Item' },
                    { key: 'children', label: 'Children' },
                    { key: 'cost', label: 'Cost', money: true },
                    { key: 'revenue', label: 'Revenue', money: true },
                    { key: 'margin', label: 'Margin', money: true },
                    { key: 'margin_pct', label: 'Margin %' },
                  ]}
                  rows={yieldExportRows}
                />
              </div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Parent Item / Channel</th>
                    <th>Children</th>
                    <th>Cost</th>
                    <th>Revenue</th>
                    <th>Margin</th>
                    <th>Margin %</th>
                  </tr>
                </thead>
                <tbody>
                  {yieldGroupRows.map((r) => (
                    <Fragment key={r.parentName}>
                      <tr style={{ fontWeight: 700, background: 'var(--bg)' }}>
                        <td>{r.parentName}</td>
                        <td>{r.childNames}</td>
                        <td>{formatMoney(r.parentCost)}</td>
                        <td>{formatMoney(r.childrenRevenue)}</td>
                        <td>
                          <span className={r.margin >= 0 ? 'tag tag-success' : 'tag tag-danger'}>
                            {formatMoney(r.margin)}
                          </span>
                        </td>
                        <td>{r.marginPct}%</td>
                      </tr>
                      {r.channelBreakdown.map((cb) => (
                        <tr key={`${r.parentName}-${cb.channel}`}>
                          <td style={{ paddingLeft: '1.75rem' }} className="muted">
                            {cb.channel}
                          </td>
                          <td></td>
                          <td className="muted">{formatMoney(cb.allocatedCost)}</td>
                          <td className="muted">{formatMoney(cb.revenue)}</td>
                          <td className="muted">
                            <span className={cb.margin >= 0 ? 'tag tag-success' : 'tag tag-danger'}>
                              {formatMoney(cb.margin)}
                            </span>
                          </td>
                          <td className="muted">{cb.marginPct}%</td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
