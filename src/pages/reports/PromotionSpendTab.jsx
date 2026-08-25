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
    // "spent" giving it away is what it cost us (its unit_cost), since no
    // revenue came in for that line at all.
    const { data } = await supabase
      .from('sale_invoice_items')
      .select('quantity, unit_cost, products(name), sale_invoices!inner(date, channel)')
      .eq('rate', 0)
      .gt('quantity', 0)
      .gte('sale_invoices.date', from)
      .lte('sale_invoices.date', to)

    const byGroup = {}
    ;(data ?? []).forEach((it) => {
      const name = it.products?.name ?? 'Unknown'
      const channel = it.sale_invoices?.channel ?? 'Unknown'
      const key = `${name}__${channel}`
      if (!byGroup[key]) byGroup[key] = { name, channel, quantity: 0, cost: 0, hasCost: false }
      byGroup[key].quantity += it.quantity
      if (it.unit_cost != null) {
        byGroup[key].cost += it.quantity * it.unit_cost
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
          item and channel. Cost is that item's average cost at the time it was given away — what the
          promotion actually spent, since no revenue came in for that line. Items with no cost on file
          (e.g. sold before cost tracking, or a cut item whose parent was never purchased) show "—".
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
