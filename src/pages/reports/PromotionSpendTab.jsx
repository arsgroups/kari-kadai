import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { formatMoney, toISODate } from '../../lib/format'
import { round2 } from '../../lib/gst'
import ExportButtons from '../../components/ExportButtons'
import ReportPrintHeader from '../../components/ReportPrintHeader'

function firstOfMonth() {
  const d = new Date()
  return toISODate(new Date(d.getFullYear(), d.getMonth(), 1))
}

export default function PromotionSpendTab() {
  const [from, setFrom] = useState(firstOfMonth())
  const [to, setTo] = useState(toISODate())
  const [rows, setRows] = useState([])
  const [totalSpend, setTotalSpend] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to])

  async function load() {
    setLoading(true)
    // A promo "Buy X Get Y Free" line is saved with rate = 0 -- what we
    // "spent" giving it away is what it cost us, since no revenue came in
    // for that line at all.
    const [{ data: rawRows }, { data: yieldItems }] = await Promise.all([
      supabase
        .from('sale_invoice_items')
        .select('id, product_id, quantity, unit_cost, products(name), sale_invoices!inner(date, channel)')
        .eq('rate', 0)
        .gt('quantity', 0)
        .gte('sale_invoices.date', from)
        .lte('sale_invoices.date', to),
      supabase
        .from('yield_configuration_items')
        .select('child_product_id, is_active, yield_configurations!inner(parent_product_id, is_active)')
        .eq('is_active', true)
        .eq('yield_configurations.is_active', true),
    ])

    // If the given-away item is a cut/yield-child, its own unit_cost is
    // often 0/unreliable (only the parent is ever purchased) -- use the
    // parent's current average cost instead, same as the Yield Group
    // Margin logic elsewhere.
    const parentIdByChild = {}
    ;(yieldItems ?? []).forEach((y) => {
      parentIdByChild[y.child_product_id] = y.yield_configurations.parent_product_id
    })
    const parentIds = [...new Set(Object.values(parentIdByChild))]
    let parentCostById = {}
    if (parentIds.length > 0) {
      const { data: parents } = await supabase.from('products').select('id, average_cost').in('id', parentIds)
      ;(parents ?? []).forEach((p) => {
        parentCostById[p.id] = p.average_cost
      })
    }

    // A returned freebie is a null giveaway -- net it back out.
    const itemIds = (rawRows ?? []).map((it) => it.id)
    let returnedByItemId = {}
    if (itemIds.length) {
      const { data: returnRows } = await supabase
        .from('sale_return_items')
        .select('sale_invoice_item_id, quantity')
        .in('sale_invoice_item_id', itemIds)
      ;(returnRows ?? []).forEach((r) => {
        returnedByItemId[r.sale_invoice_item_id] = (returnedByItemId[r.sale_invoice_item_id] ?? 0) + r.quantity
      })
    }
    const data = (rawRows ?? [])
      .map((it) => ({ ...it, quantity: round2(it.quantity - (returnedByItemId[it.id] ?? 0)) }))
      .filter((it) => it.quantity > 0)

    const byGroup = {}
    ;(data ?? []).forEach((it) => {
      const name = it.products?.name ?? 'Unknown'
      const channel = it.sale_invoices?.channel ?? 'Unknown'
      const key = `${name}__${channel}`
      if (!byGroup[key]) byGroup[key] = { name, channel, quantity: 0, cost: 0, hasCost: false }
      byGroup[key].quantity += it.quantity

      const parentId = parentIdByChild[it.product_id]
      const unitCost = parentId != null ? parentCostById[parentId] : it.unit_cost
      if (unitCost != null) {
        byGroup[key].cost += it.quantity * unitCost
        byGroup[key].hasCost = true
      }
    })

    const list = Object.values(byGroup)
      .map((r) => ({ ...r, quantity: round2(r.quantity), cost: round2(r.cost) }))
      .sort((a, b) => b.cost - a.cost)

    setRows(list)
    setTotalSpend(round2(list.reduce((sum, r) => sum + (r.hasCost ? r.cost : 0), 0)))
    setLoading(false)
  }

  const exportRows = rows.map((r) => ({
    name: r.name,
    channel: r.channel,
    quantity: r.quantity,
    cost: r.hasCost ? r.cost : '',
  }))

  return (
    <div>
      <ReportPrintHeader title="Promotion Spend" />
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
          Every item given away free by a Buy X Get Y Free promotion (price $0 on the invoice), grouped by
          item and channel. Cost is that item's average cost — what the promotion actually spent, since no
          revenue came in for that line. For a cut/yield item (e.g. a free Wing), the parent's current
          average cost (e.g. Whole Chicken) is used instead of the child's own, since only the parent is
          ever purchased. A returned giveaway is netted out, so it isn't counted here either. Items with no
          cost on file (parent or item never purchased, or sold before cost tracking) show "—".
        </p>
      </div>

      <div className="toolbar">
        <div className="tile" style={{ margin: 0 }}>
          <div className="tile-label">Total Promotion Spend</div>
          <div className="tile-value">{formatMoney(totalSpend)}</div>
        </div>
        <ExportButtons
          title={`Promotion Spend: ${from} to ${to}`}
          filename="promotion_spend"
          columns={[
            { key: 'name', label: 'Item' },
            { key: 'channel', label: 'Channel' },
            { key: 'quantity', label: 'Qty Given Free' },
            { key: 'cost', label: 'Cost (Promo Spend)', money: true },
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
                <th>Channel</th>
                <th>Qty Given Free</th>
                <th>Cost (Promo Spend)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.name}-${r.channel}`}>
                  <td>{r.name}</td>
                  <td>{r.channel}</td>
                  <td>{r.quantity}</td>
                  <td>{r.hasCost ? formatMoney(r.cost) : '—'}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">
                    No promotional giveaways in this range.
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
