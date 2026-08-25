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
  const [yieldGroupRows, setYieldGroupRows] = useState([])

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to])

  async function load() {
    setLoading(true)
    const [{ data: invoiceRows }, { data: rawItemRows }, { data: yieldConfigs }] = await Promise.all([
      supabase.from('sale_invoices').select('date, channel, total').gte('date', from).lte('date', to),
      supabase
        .from('sale_invoice_items')
        .select('id, product_id, quantity, amount, unit_cost, products(name), sale_invoices!inner(date, channel)')
        .gte('sale_invoices.date', from)
        .lte('sale_invoices.date', to),
      supabase
        .from('yield_configurations')
        .select(
          'id, parent_product_id, products(name), yield_configuration_items(child_product_id, is_active, products(name))'
        )
        .eq('is_active', true),
    ])

    // A returned line is "a null sale" -- net its quantity/amount back out
    // of the original sale_invoice_items row before it feeds Top Items or
    // Yield Group Margin (the main Channel Revenue table above already
    // reflects returns, since a return reduces the invoice's own total).
    const itemIds = (rawItemRows ?? []).map((it) => it.id)
    let returnedByItemId = {}
    if (itemIds.length) {
      const { data: returnRows } = await supabase
        .from('sale_return_items')
        .select('sale_invoice_item_id, quantity, amount')
        .in('sale_invoice_item_id', itemIds)
      ;(returnRows ?? []).forEach((r) => {
        if (!returnedByItemId[r.sale_invoice_item_id]) returnedByItemId[r.sale_invoice_item_id] = { quantity: 0, amount: 0 }
        returnedByItemId[r.sale_invoice_item_id].quantity += r.quantity
        returnedByItemId[r.sale_invoice_item_id].amount += r.amount
      })
    }
    const itemRows = (rawItemRows ?? [])
      .map((it) => {
        const returned = returnedByItemId[it.id]
        return returned
          ? { ...it, quantity: round2(it.quantity - returned.quantity), amount: round2(it.amount - returned.amount) }
          : it
      })
      .filter((it) => it.quantity > 0)

    // Every sale, historical or current -- full invoice total (matches
    // Sales report / P&L), no cost/margin here.
    const revenueByChannel = Object.fromEntries(CHANNELS.map((c) => [c, 0]))
    ;(invoiceRows ?? []).forEach((inv) => {
      if (revenueByChannel[inv.channel] != null) revenueByChannel[inv.channel] += inv.total
    })
    setChannelRows(CHANNELS.map((c) => ({ channel: c, revenue: round2(revenueByChannel[c]) })))

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
      if (!itemsByChannel[channel]) return
      const name = it.products?.name ?? 'Unknown'
      itemsByChannel[channel][name] = (itemsByChannel[channel][name] ?? 0) + it.amount
    })

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
      byDay[inv.date][inv.channel] = round2((byDay[inv.date][inv.channel] ?? 0) + inv.total)
    })
    setTrendData(Object.keys(byDay).sort().map((d) => byDay[d]))

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

  const exportRows = channelRows.map((r) => ({ channel: r.channel, revenue: r.revenue }))

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
          Revenue is each channel's full invoice total (matches the Sales report and P&amp;L), covering
          every sale in the range — historical entries and current itemized sales alike. Returned amounts
          are excluded throughout (a return is never counted as a sale).
        </p>
      </div>

      <div className="toolbar">
        <ExportButtons
          title={`Channel Sales: ${from} to ${to}`}
          filename="channel_sales"
          columns={[
            { key: 'channel', label: 'Channel' },
            { key: 'revenue', label: 'Revenue', money: true },
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
                </tr>
              </thead>
              <tbody>
                {channelRows.map((r) => (
                  <tr key={r.channel}>
                    <td>{r.channel}</td>
                    <td>{formatMoney(r.revenue)}</td>
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
                  Where {c.toLowerCase()} revenue concentrates (top 5 by revenue in range, itemized sales
                  only).
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
                purchases aren't recorded per channel. Itemized sales only (same as Top Items above).
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
