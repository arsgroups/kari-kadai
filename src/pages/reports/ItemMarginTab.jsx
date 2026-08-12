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

export default function ItemMarginTab() {
  const [from, setFrom] = useState(firstOfMonth())
  const [to, setTo] = useState(toISODate())
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to])

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('sale_invoice_items')
      .select('quantity, amount, unit_cost, products(name), sale_invoices!inner(date)')
      .gte('sale_invoices.date', from)
      .lte('sale_invoices.date', to)

    const byProduct = {}
    ;(data ?? []).forEach((it) => {
      const name = it.products?.name ?? 'Unknown'
      if (!byProduct[name]) byProduct[name] = { name, quantity: 0, revenue: 0, cost: 0, hasCost: false }
      byProduct[name].quantity += it.quantity
      byProduct[name].revenue += it.amount
      if (it.unit_cost != null) {
        byProduct[name].cost += it.quantity * it.unit_cost
        byProduct[name].hasCost = true
      }
    })

    const list = Object.values(byProduct)
      .map((r) => ({
        ...r,
        quantity: round2(r.quantity),
        revenue: round2(r.revenue),
        cost: round2(r.cost),
        margin: round2(r.revenue - r.cost),
        marginPct: r.revenue > 0 ? round2(((r.revenue - r.cost) / r.revenue) * 100) : 0,
      }))
      .sort((a, b) => b.margin - a.margin)

    setRows(list)
    setLoading(false)
  }

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
          Cost uses each item's average cost at the time it was sold (weighted-average, updated by
          purchases and processing events). Items sold before cost tracking existed show "—" for cost
          and margin. This report is separate from P&amp;L, which is unaffected by this figure.
        </p>
      </div>

      <div className="toolbar">
        <ExportButtons
          title="Item Margin Report"
          filename="item_margin_report"
          columns={[
            { key: 'name', label: 'Item' },
            { key: 'quantity', label: 'Qty Sold' },
            { key: 'revenue', label: 'Revenue' },
            { key: 'cost', label: 'Allocated Cost' },
            { key: 'margin', label: 'Margin' },
            { key: 'marginPct', label: 'Margin %' },
          ]}
          rows={rows}
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
                <th>Allocated Cost</th>
                <th>Margin</th>
                <th>Margin %</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
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
              {rows.length === 0 && (
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
