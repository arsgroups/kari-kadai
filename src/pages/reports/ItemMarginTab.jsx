import { Fragment, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { formatMoney, toISODate } from '../../lib/format'
import { round2 } from '../../lib/gst'
import ExportButtons from '../../components/ExportButtons'
import ReportPrintHeader from '../../components/ReportPrintHeader'

function firstOfMonth() {
  const d = new Date()
  return toISODate(new Date(d.getFullYear(), d.getMonth(), 1))
}

export default function ItemMarginTab() {
  const [from, setFrom] = useState(firstOfMonth())
  const [to, setTo] = useState(toISODate())
  const [groupRows, setGroupRows] = useState([])
  const [standaloneRows, setStandaloneRows] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to])

  async function load() {
    setLoading(true)
    // Only reads sale_invoice_items, so Historical Data Entry backfill (no
    // line items) never appears here -- this is already "current data only".
    const [{ data: items }, { data: yieldConfigs }] = await Promise.all([
      supabase
        .from('sale_invoice_items')
        .select('product_id, quantity, amount, unit_cost, products(name), sale_invoices!inner(date)')
        .gte('sale_invoices.date', from)
        .lte('sale_invoices.date', to),
      supabase
        .from('yield_configurations')
        .select(
          'id, parent_product_id, products(name), yield_configuration_items(child_product_id, is_active, products(name))'
        )
        .eq('is_active', true),
    ])

    const groups = (yieldConfigs ?? [])
      .map((g) => {
        const children = (g.yield_configuration_items ?? []).filter((ci) => ci.is_active)
        return {
          parentId: g.parent_product_id,
          parentName: g.products?.name ?? 'Unknown',
          childIds: new Set(children.map((ci) => ci.child_product_id)),
          childNames: Object.fromEntries(children.map((ci) => [ci.child_product_id, ci.products?.name ?? 'Unknown'])),
        }
      })
      .filter((g) => g.childIds.size > 0)

    // Map every yield-child product straight to its group for O(1) lookup.
    const groupByChildId = {}
    groups.forEach((g) => {
      g.childIds.forEach((childId) => {
        groupByChildId[childId] = g
      })
    })

    const childTallyByGroup = {}
    const standaloneByProduct = {}
    ;(items ?? []).forEach((it) => {
      const group = groupByChildId[it.product_id]
      if (group) {
        if (!childTallyByGroup[group.parentId]) childTallyByGroup[group.parentId] = {}
        const tally = childTallyByGroup[group.parentId]
        const name = it.products?.name ?? group.childNames[it.product_id] ?? 'Unknown'
        if (!tally[it.product_id]) tally[it.product_id] = { name, quantity: 0, revenue: 0 }
        tally[it.product_id].quantity += it.quantity
        tally[it.product_id].revenue += it.amount
      } else {
        const name = it.products?.name ?? 'Unknown'
        if (!standaloneByProduct[name])
          standaloneByProduct[name] = { name, quantity: 0, revenue: 0, cost: 0, hasCost: false }
        standaloneByProduct[name].quantity += it.quantity
        standaloneByProduct[name].revenue += it.amount
        if (it.unit_cost != null) {
          standaloneByProduct[name].cost += it.quantity * it.unit_cost
          standaloneByProduct[name].hasCost = true
        }
      }
    })

    // Parent's own purchase cost this period -- there's no stored yield
    // ratio to split it precisely per child, so margin only exists at the
    // group level: parent cost vs. the children's cumulative revenue.
    let costByParent = {}
    const parentIds = groups.map((g) => g.parentId)
    if (parentIds.length > 0) {
      const { data: parentPurchases } = await supabase
        .from('purchase_invoice_items')
        .select('product_id, amount, purchase_invoices!inner(date)')
        .in('product_id', parentIds)
        .gte('purchase_invoices.date', from)
        .lte('purchase_invoices.date', to)
      ;(parentPurchases ?? []).forEach((p) => {
        costByParent[p.product_id] = (costByParent[p.product_id] ?? 0) + p.amount
      })
    }

    const groupList = groups
      .filter((g) => childTallyByGroup[g.parentId])
      .map((g) => {
        const children = Object.values(childTallyByGroup[g.parentId])
          .map((c) => ({ ...c, quantity: round2(c.quantity), revenue: round2(c.revenue) }))
          .sort((a, b) => b.revenue - a.revenue)
        const cost = round2(costByParent[g.parentId] ?? 0)
        const revenue = round2(children.reduce((sum, c) => sum + c.revenue, 0))
        const margin = round2(revenue - cost)
        return {
          parentName: g.parentName,
          children,
          cost,
          revenue,
          margin,
          marginPct: revenue > 0 ? round2((margin / revenue) * 100) : 0,
        }
      })
      .sort((a, b) => b.margin - a.margin)

    const standaloneList = Object.values(standaloneByProduct)
      .map((r) => ({
        ...r,
        quantity: round2(r.quantity),
        revenue: round2(r.revenue),
        cost: round2(r.cost),
        margin: round2(r.revenue - r.cost),
        marginPct: r.revenue > 0 ? round2(((r.revenue - r.cost) / r.revenue) * 100) : 0,
      }))
      .sort((a, b) => b.margin - a.margin)

    setGroupRows(groupList)
    setStandaloneRows(standaloneList)
    setLoading(false)
  }

  const exportRows = [
    ...groupRows.flatMap((g) => [
      { name: `${g.parentName} (yield group total)`, quantity: '', revenue: g.revenue, cost: g.cost, margin: g.margin, marginPct: `${g.marginPct}%` },
      ...g.children.map((c) => ({
        name: `  — ${c.name}`,
        quantity: c.quantity,
        revenue: c.revenue,
        cost: '',
        margin: '',
        marginPct: '',
      })),
    ]),
    ...standaloneRows.map((r) => ({
      name: r.name,
      quantity: r.quantity,
      revenue: r.revenue,
      cost: r.hasCost ? r.cost : '',
      margin: r.hasCost ? r.margin : '',
      marginPct: r.hasCost ? `${r.marginPct}%` : '',
    })),
  ]

  return (
    <div>
      <ReportPrintHeader title="Item Margin Report" />
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
          Only reflects itemized (current-system) sales — Historical Data Entry backfill has no line
          items, so it never appears here. Items cut from a purchased parent (e.g. a whole chicken cut
          into breast/thigh/wing) are grouped under that parent: since there's no stored yield ratio to
          split the parent's cost precisely per child, the parent header shows the parent's purchase cost
          against the <strong>combined</strong> revenue of all its children — the breakdown below it shows
          each child's own quantity and revenue, with no separate cost/margin per child. Standalone items
          (purchased and sold directly, not cut) keep their own individual cost/margin as before.
        </p>
      </div>

      <div className="toolbar">
        <ExportButtons
          title="Item Margin Report"
          filename="item_margin_report"
          columns={[
            { key: 'name', label: 'Item' },
            { key: 'quantity', label: 'Qty Sold' },
            { key: 'revenue', label: 'Revenue', money: true },
            { key: 'cost', label: 'Cost', money: true },
            { key: 'margin', label: 'Margin', money: true },
            { key: 'marginPct', label: 'Margin %' },
          ]}
          rows={exportRows}
        />
      </div>

      <div className="card">
        {loading ? (
          <p className="muted">Loading…</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Qty Sold</th>
                <th>Revenue</th>
                <th>Cost</th>
                <th>Margin</th>
                <th>Margin %</th>
              </tr>
            </thead>
            <tbody>
              {groupRows.map((g) => (
                <Fragment key={g.parentName}>
                  <tr style={{ fontWeight: 700, background: 'var(--bg)' }}>
                    <td>{g.parentName}</td>
                    <td></td>
                    <td>{formatMoney(g.revenue)}</td>
                    <td>{formatMoney(g.cost)}</td>
                    <td>
                      <span className={g.margin >= 0 ? 'tag tag-success' : 'tag tag-danger'}>
                        {formatMoney(g.margin)}
                      </span>
                    </td>
                    <td>{g.marginPct}%</td>
                  </tr>
                  {g.children.map((c) => (
                    <tr key={`${g.parentName}-${c.name}`}>
                      <td style={{ paddingLeft: '1.75rem' }} className="muted">
                        {c.name}
                      </td>
                      <td>{c.quantity}</td>
                      <td>{formatMoney(c.revenue)}</td>
                      <td className="muted">—</td>
                      <td className="muted">—</td>
                      <td className="muted">—</td>
                    </tr>
                  ))}
                </Fragment>
              ))}
              {standaloneRows.map((r) => (
                <tr key={r.name}>
                  <td>{r.name}</td>
                  <td>{r.quantity}</td>
                  <td>{formatMoney(r.revenue)}</td>
                  <td>{r.hasCost ? formatMoney(r.cost) : '—'}</td>
                  <td>
                    {r.hasCost ? (
                      <span className={r.margin >= 0 ? 'tag tag-success' : 'tag tag-danger'}>{formatMoney(r.margin)}</span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>{r.hasCost ? `${r.marginPct}%` : '—'}</td>
                </tr>
              ))}
              {groupRows.length === 0 && standaloneRows.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    No sales in this range.
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
