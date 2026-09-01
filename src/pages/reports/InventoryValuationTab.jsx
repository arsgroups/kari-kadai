import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { formatMoney, toISODate } from '../../lib/format'
import { round2 } from '../../lib/gst'
import ExportButtons from '../../components/ExportButtons'
import ReportPrintHeader from '../../components/ReportPrintHeader'

// Every stock movement up to (and including) asOfDate, summed per product --
// paginated since a mature shop's full movement history can exceed
// PostgREST's default 1000-row page.
async function fetchStockAsOf(asOfDate) {
  const pageSize = 1000
  const totals = {}
  let from = 0
  for (;;) {
    const { data, error } = await supabase
      .from('stock_movements')
      .select('product_id, quantity')
      .lte('date', asOfDate)
      .range(from, from + pageSize - 1)
    if (error) throw error
    ;(data ?? []).forEach((m) => {
      totals[m.product_id] = (totals[m.product_id] ?? 0) + Number(m.quantity)
    })
    if (!data || data.length < pageSize) break
    from += pageSize
  }
  return totals
}

export default function InventoryValuationTab() {
  const [asOfDate, setAsOfDate] = useState(toISODate())
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asOfDate])

  async function load() {
    setLoading(true)
    const [{ data: products }, stockByProduct] = await Promise.all([
      supabase
        .from('products')
        .select('id, name, category, unit, average_cost, default_purchase_price')
        .eq('is_active', true)
        .order('name'),
      fetchStockAsOf(asOfDate),
    ])

    const enriched = (products ?? []).map((p) => {
      const costRate = p.average_cost || p.default_purchase_price || 0
      const current_stock = round2(stockByProduct[p.id] ?? 0)
      return {
        product_id: p.id,
        name: p.name,
        category: p.category,
        unit: p.unit,
        current_stock,
        costRate,
        value: round2(current_stock * costRate),
      }
    })

    setRows(enriched)
    setLoading(false)
  }

  const totalValue = rows.reduce((sum, r) => sum + r.value, 0)

  const exportRows = rows.map((r) => ({
    name: r.name,
    category: r.category,
    current_stock: r.current_stock,
    unit: r.unit,
    cost_rate: r.costRate,
    value: r.value,
  }))

  return (
    <div>
      <ReportPrintHeader title="Inventory Valuation" />
      <p className="muted" style={{ fontSize: '0.85rem' }}>
        Stock quantity is the running total of all stock movements up to and including the date below.
        Cost rate is each item's <strong>current</strong> weighted-average cost (updated by purchases and,
        for cut/processed items, their allocated processing cost) — falling back to its default purchase
        price if it has no cost history yet. Cost rate isn't tracked historically, so for a past date this
        values that date's quantity at today's cost, not the cost that was actually in effect then.
      </p>
      <div className="toolbar">
        <label>
          As of Date
          <input
            type="date"
            value={asOfDate}
            onChange={(e) => setAsOfDate(e.target.value)}
            style={{ marginLeft: '0.5rem' }}
          />
        </label>
        <div className="tile" style={{ margin: 0 }}>
          <div className="tile-label">Total Inventory Value (as of {asOfDate})</div>
          <div className="tile-value">{formatMoney(totalValue)}</div>
        </div>
        <ExportButtons
          title={`Inventory Valuation as of ${asOfDate}`}
          filename={`inventory_valuation_${asOfDate}`}
          columns={[
            { key: 'name', label: 'Item' },
            { key: 'category', label: 'Category' },
            { key: 'current_stock', label: `Stock (as of ${asOfDate})` },
            { key: 'unit', label: 'Unit' },
            { key: 'cost_rate', label: 'Cost Rate', money: true },
            { key: 'value', label: 'Value', money: true },
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
                <th>Category</th>
                <th>Stock (as of {asOfDate})</th>
                <th>Cost Rate</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.product_id}>
                  <td>{r.name}</td>
                  <td>{r.category}</td>
                  <td>
                    {r.current_stock} {r.unit}
                  </td>
                  <td>{formatMoney(r.costRate)}</td>
                  <td>{formatMoney(r.value)}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    No active items.
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
